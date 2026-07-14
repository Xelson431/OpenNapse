import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { ensurePersonalWorkspace } from '../auth/ensure-personal-workspace'

declare const process: { env: Record<string, string | undefined> }

const env = {
  url: process.env.SUPABASE_TEST_URL,
  anonKey: process.env.SUPABASE_TEST_ANON_KEY,
  serviceRoleKey: process.env.SUPABASE_TEST_SERVICE_ROLE_KEY,
}

const hasRlsEnv = Boolean(env.url && env.anonKey && env.serviceRoleKey)
const describeRls = hasRlsEnv ? describe : describe.skip

type TestUser = {
  id: string
  email: string
  password: string
  client: SupabaseClient
  workspaceId: string
}

function adminClient() {
  return createClient(env.url!, env.serviceRoleKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

async function createTestUser(label: string): Promise<TestUser> {
  const admin = adminClient()
  const password = crypto.randomUUID() + 'Aa1!'
  const email = `rls-${label}-${crypto.randomUUID()}@opennapse.test`
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (createError || !created.user) throw createError ?? new Error('Failed to create test user')

  const client = createClient(env.url!, env.anonKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { error: signInError } = await client.auth.signInWithPassword({ email, password })
  if (signInError) throw signInError

  const bootstrapped = await ensurePersonalWorkspace(client, { id: created.user.id, email })
  if (!bootstrapped.ok) throw new Error(bootstrapped.message)

  return { id: created.user.id, email, password, client, workspaceId: bootstrapped.workspaceId }
}

async function deleteTestUser(user: TestUser | null) {
  if (!user) return
  await user.client.auth.signOut()
  await adminClient().auth.admin.deleteUser(user.id)
}

function projectRow(user: TestUser) {
  return {
    workspace_id: user.workspaceId,
    created_by: user.id,
    title: `Private project ${crypto.randomUUID()}`,
    description: '',
    why_now: 'Validate RLS isolation',
    first_step: 'Write a row as user A',
    done_looks_like: 'User B cannot access it',
    client_id: 'rls-test',
    device_id: 'rls-test-device',
  }
}

describeRls('Supabase RLS integration', () => {
  let userA: TestUser | null = null
  let userB: TestUser | null = null
  const createdTeamIds: string[] = []

  beforeAll(async () => {
    userA = await createTestUser('a')
    userB = await createTestUser('b')
  }, 60_000)

  afterAll(async () => {
    if (createdTeamIds.length > 0) {
      await adminClient().from('teams').delete().in('id', createdTeamIds)
    }
    await deleteTestUser(userA)
    await deleteTestUser(userB)
  }, 60_000)

  it('prevents a different user from reading workspace content rows', async () => {
    expect(userA).toBeTruthy()
    expect(userB).toBeTruthy()
    const { data: inserted, error: insertError } = await userA!.client
      .from('projects')
      .insert(projectRow(userA!))
      .select('id')
      .single()
    expect(insertError).toBeNull()
    expect(inserted?.id).toBeTruthy()

    const { data: visibleToA, error: readAError } = await userA!.client
      .from('projects')
      .select('id')
      .eq('id', inserted!.id)
    expect(readAError).toBeNull()
    expect(visibleToA).toHaveLength(1)

    const { data: visibleToB, error: readBError } = await userB!.client
      .from('projects')
      .select('id')
      .eq('id', inserted!.id)
    expect(readBError).toBeNull()
    expect(visibleToB).toHaveLength(0)
  }, 60_000)

  it('prevents a different user from updating workspace content rows', async () => {
    const { data: inserted, error: insertError } = await userA!.client
      .from('projects')
      .insert(projectRow(userA!))
      .select('id, title')
      .single()
    expect(insertError).toBeNull()

    const { data: updatedByB, error: updateBError } = await userB!.client
      .from('projects')
      .update({ title: 'tampered' })
      .eq('id', inserted!.id)
      .select('id')
    expect(updateBError).toBeNull()
    expect(updatedByB).toHaveLength(0)

    const { data: reloaded, error: reloadError } = await userA!.client
      .from('projects')
      .select('title')
      .eq('id', inserted!.id)
      .single()
    expect(reloadError).toBeNull()
    expect(reloaded?.title).toBe(inserted!.title)
  }, 60_000)

  it('allows viewer reads but blocks viewer writes', async () => {
    const admin = adminClient()
    const { error: memberError } = await admin.from('workspace_members').upsert({
      workspace_id: userA!.workspaceId,
      user_id: userB!.id,
      role: 'viewer',
      status: 'active',
    }, { onConflict: 'workspace_id,user_id' })
    expect(memberError).toBeNull()

    const { data: visible, error: readError } = await userB!.client
      .from('workspaces')
      .select('id')
      .eq('id', userA!.workspaceId)
    expect(readError).toBeNull()
    expect(visible).toHaveLength(1)

    const { error: writeError } = await userB!.client
      .from('projects')
      .insert({ ...projectRow(userA!), created_by: userB!.id })
    expect(writeError).toBeTruthy()
  }, 60_000)

  it('removes access when a workspace membership is removed', async () => {
    const admin = adminClient()
    const { error: removedError } = await admin
      .from('workspace_members')
      .update({ status: 'removed' })
      .eq('workspace_id', userA!.workspaceId)
      .eq('user_id', userB!.id)
    expect(removedError).toBeNull()

    const { data: visible, error: readError } = await userB!.client
      .from('workspaces')
      .select('id')
      .eq('id', userA!.workspaceId)
    expect(readError).toBeNull()
    expect(visible).toHaveLength(0)
  }, 60_000)

  it('prevents direct owner removal and deletion-state injection', async () => {
    // The hardening migration dropped the browser UPDATE policy on
    // workspace_members, so a direct owner-removal UPDATE matches no policy and
    // RLS silently affects zero rows (no thrown error). Assert the owner row is
    // unchanged rather than expecting an error PostgREST does not raise.
    await userA!.client.from('workspace_members')
      .update({ status: 'removed' }).eq('workspace_id', userA!.workspaceId).eq('user_id', userA!.id)
    const { data: ownerRow, error: ownerReadError } = await userA!.client.from('workspace_members')
      .select('status, role').eq('workspace_id', userA!.workspaceId).eq('user_id', userA!.id).single()
    expect(ownerReadError).toBeNull()
    expect(ownerRow?.status).toBe('active')
    expect(ownerRow?.role).toBe('owner')

    const { error: injectedDeletionError } = await userA!.client.from('deletion_requests').insert({
      scope: 'workspace', workspace_id: userA!.workspaceId, requested_by: userA!.id,
      status: 'approved', confirmation_token: crypto.randomUUID(), scheduled_for: new Date().toISOString(),
    })
    expect(injectedDeletionError).toBeTruthy()
  }, 60_000)

  it('rejects cross-workspace references', async () => {
    const { data: foreignProject, error: projectError } = await userA!.client.from('projects').insert(projectRow(userA!)).select('id').single()
    expect(projectError).toBeNull()
    const { error } = await userB!.client.from('tasks').insert({
      workspace_id: userB!.workspaceId, created_by: userB!.id, project_id: foreignProject!.id,
      title: 'Invalid cross-workspace task', client_id: 'rls-test', device_id: 'rls-test-device',
    })
    expect(error).toBeTruthy()
  }, 60_000)

  it('deduplicates replayed sync mutations', async () => {
    const mutationId = crypto.randomUUID()
    const logicalId = crypto.randomUUID()
    const args = {
      target_workspace_id: userA!.workspaceId,
      mutations: [{ mutationId, entityType: 'projects', logicalId, operation: 'upsert', expectedVersion: 0, payload: {
        title: 'Idempotent project', description: '', whyNow: 'Replay safety', firstStep: 'Apply once', doneLooksLike: 'One change row', status: 'planning', color: '#78716C', clientId: 'rls-test', deviceId: 'rls-test-device',
      } }],
    }
    const first = await userA!.client.rpc('apply_sync_mutations', args)
    const replay = await userA!.client.rpc('apply_sync_mutations', args)
    expect(first.error).toBeNull()
    expect(replay.error).toBeNull()
    expect(replay.data).toEqual(first.data)
    const { count } = await userA!.client.from('sync_changes').select('cursor', { count: 'exact', head: true }).eq('mutation_id', mutationId)
    expect(count).toBe(1)
  }, 60_000)

  it('reuses the existing personal workspace without an ambiguous column error', async () => {
    // Regression: the reuse branch of create_workspace referenced a bare
    // workspace_id (in ON CONFLICT / INSERT) that collided with the RETURNS
    // TABLE OUT column under #variable_conflict error, raising "column
    // reference workspace_id is ambiguous" for every returning user at
    // bootstrap. userA already has a personal workspace, so this call takes the
    // reuse branch and must succeed, returning the same id with created=false.
    const { data, error } = await userA!.client.rpc('create_workspace', {
      requested_name: 'Personal',
      requested_type: 'personal',
      idempotency_key: crypto.randomUUID(),
    })
    expect(error).toBeNull()
    expect(data![0].workspace_id).toBe(userA!.workspaceId)
    expect(data![0].created).toBe(false)
  }, 60_000)

  it('scopes workspace idempotency to caller and validated request payload', async () => {
    const key = crypto.randomUUID()
    const first = await userA!.client.rpc('create_workspace', {
      requested_name: 'User A replay workspace',
      requested_type: 'team',
      idempotency_key: key,
    })
    const replay = await userA!.client.rpc('create_workspace', {
      requested_name: 'User A replay workspace',
      requested_type: 'team',
      idempotency_key: key,
    })
    const conflict = await userA!.client.rpc('create_workspace', {
      requested_name: 'Different replay payload',
      requested_type: 'team',
      idempotency_key: key,
    })
    const otherUser = await userB!.client.rpc('create_workspace', {
      requested_name: 'User B independent workspace',
      requested_type: 'team',
      idempotency_key: key,
    })

    expect(first.error).toBeNull()
    expect(replay.error).toBeNull()
    expect(replay.data).toEqual([{ workspace_id: first.data![0].workspace_id, created: false }])
    expect(conflict.error?.message).toMatch(/different workspace request/i)
    expect(otherUser.error).toBeNull()
    expect(otherUser.data![0].workspace_id).not.toBe(first.data![0].workspace_id)
  }, 60_000)

  it('creates one team and workspace atomically and replays safely', async () => {
    const key = crypto.randomUUID()
    const first = await userA!.client.rpc('create_team_with_workspace', {
      requested_team_name: 'Atomic team',
      requested_workspace_name: 'Atomic workspace',
      idempotency_key: key,
    })
    expect(first.error).toBeNull()
    const created = first.data![0] as { team_id: string; workspace_id: string; created: boolean }
    createdTeamIds.push(created.team_id)

    const replay = await userA!.client.rpc('create_team_with_workspace', {
      requested_team_name: 'Atomic team',
      requested_workspace_name: 'Atomic workspace',
      idempotency_key: key,
    })
    const conflict = await userA!.client.rpc('create_team_with_workspace', {
      requested_team_name: 'Conflicting team',
      requested_workspace_name: 'Atomic workspace',
      idempotency_key: key,
    })

    expect(replay.error).toBeNull()
    expect(replay.data).toEqual([{ ...created, created: false }])
    expect(conflict.error?.message).toMatch(/different team request/i)

    const admin = adminClient()
    const { count: ownerCount } = await admin.from('team_members').select('id', { count: 'exact', head: true })
      .eq('team_id', created.team_id).eq('role', 'owner').eq('status', 'active')
    const { count: linkCount } = await admin.from('team_workspaces').select('team_id', { count: 'exact', head: true })
      .eq('team_id', created.team_id).eq('workspace_id', created.workspace_id)
    expect(ownerCount).toBe(1)
    expect(linkCount).toBe(1)
  }, 60_000)

  it('closes direct browser team mutation and invitation writes', async () => {
    const created = await userA!.client.rpc('create_team_with_workspace', {
      requested_team_name: 'Closed mutation team',
      requested_workspace_name: 'Closed mutation workspace',
      idempotency_key: crypto.randomUUID(),
    })
    expect(created.error).toBeNull()
    const row = created.data![0] as { team_id: string; workspace_id: string }
    createdTeamIds.push(row.team_id)

    const add = await userA!.client.rpc('add_team_member', {
      target_team_id: row.team_id,
      target_user_id: userB!.id,
      member_role: 'member',
    })
    const attach = await userA!.client.rpc('attach_team_to_workspace', {
      target_team_id: row.team_id,
      target_workspace_id: userA!.workspaceId,
    })
    const directMember = await userA!.client.from('team_members').insert({
      team_id: row.team_id,
      user_id: userB!.id,
      role: 'member',
      status: 'active',
    })
    const directInvite = await userA!.client.from('team_invites').insert({
      team_id: row.team_id,
      inviter_user_id: userA!.id,
      email: userB!.email.toLowerCase(),
      role: 'member',
      token_hash: 'a'.repeat(64),
    })

    expect(add.error).toBeTruthy()
    expect(attach.error).toBeTruthy()
    expect(directMember.error).toBeTruthy()
    expect(directInvite.error).toBeTruthy()
  }, 60_000)

  it('grants workspace discovery and editing through effective team membership', async () => {
    const created = await userA!.client.rpc('create_team_with_workspace', {
      requested_team_name: 'Effective access team',
      requested_workspace_name: 'Effective access workspace',
      idempotency_key: crypto.randomUUID(),
    })
    expect(created.error).toBeNull()
    const row = created.data![0] as { team_id: string; workspace_id: string }
    createdTeamIds.push(row.team_id)

    const admin = adminClient()
    const { error: memberError } = await admin.from('team_members').insert({
      team_id: row.team_id,
      user_id: userB!.id,
      role: 'member',
      status: 'active',
    })
    expect(memberError).toBeNull()

    const { data: visible, error: visibleError } = await userB!.client.from('workspaces')
      .select('id').eq('id', row.workspace_id)
    expect(visibleError).toBeNull()
    expect(visible).toHaveLength(1)

    const { error: projectError } = await userB!.client.from('projects').insert({
      workspace_id: row.workspace_id,
      created_by: userB!.id,
      title: 'Team member project',
      description: '',
      why_now: 'Effective team membership',
      first_step: 'Create it',
      done_looks_like: 'Visible to the team',
      client_id: 'rls-team-test',
      device_id: 'rls-team-test',
    })
    expect(projectError).toBeNull()
  }, 60_000)

  it('supports team-member assignment and prevents forged task attribution', async () => {
    const created = await userA!.client.rpc('create_team_with_workspace', {
      requested_team_name: 'Attribution team',
      requested_workspace_name: 'Attribution workspace',
      idempotency_key: crypto.randomUUID(),
    })
    expect(created.error).toBeNull()
    const row = created.data![0] as { team_id: string; workspace_id: string }
    createdTeamIds.push(row.team_id)

    const admin = adminClient()
    expect((await admin.from('team_members').insert({
      team_id: row.team_id,
      user_id: userB!.id,
      role: 'member',
      status: 'active',
    })).error).toBeNull()

    const { data: project, error: projectError } = await userA!.client.from('projects').insert({
      workspace_id: row.workspace_id,
      created_by: userA!.id,
      title: 'Attribution project',
      description: '',
      why_now: 'Verify attribution',
      first_step: 'Create task',
      done_looks_like: 'Server controls editor identity',
      client_id: 'rls-attribution',
      device_id: 'rls-attribution',
    }).select('id').single()
    expect(projectError).toBeNull()

    const { data: task, error: taskError } = await userA!.client.from('tasks').insert({
      workspace_id: row.workspace_id,
      created_by: userA!.id,
      updated_by: userB!.id,
      assignee_id: userB!.id,
      project_id: project!.id,
      title: 'Assigned team task',
      client_id: 'rls-attribution',
      device_id: 'rls-attribution',
    }).select('id, updated_by, assignee_id').single()
    expect(taskError).toBeNull()
    expect(task?.updated_by).toBe(userA!.id)
    expect(task?.assignee_id).toBe(userB!.id)

    const { data: updated, error: updateError } = await userA!.client.from('tasks')
      .update({ title: 'Updated task', updated_by: userB!.id })
      .eq('id', task!.id)
      .select('updated_by')
      .single()
    expect(updateError).toBeNull()
    expect(updated?.updated_by).toBe(userA!.id)
  }, 60_000)

  it('transfers team ownership atomically and preserves one owner', async () => {
    const created = await userA!.client.rpc('create_team_with_workspace', {
      requested_team_name: 'Transfer team',
      requested_workspace_name: 'Transfer workspace',
      idempotency_key: crypto.randomUUID(),
    })
    expect(created.error).toBeNull()
    const row = created.data![0] as { team_id: string }
    createdTeamIds.push(row.team_id)
    const admin = adminClient()
    expect((await admin.from('team_members').insert({
      team_id: row.team_id,
      user_id: userB!.id,
      role: 'member',
      status: 'active',
    })).error).toBeNull()

    const transfer = await userA!.client.rpc('transfer_team_ownership', {
      target_team_id: row.team_id,
      new_owner_user_id: userB!.id,
    })
    expect(transfer.error).toBeNull()

    const { data: team } = await admin.from('teams').select('owner_user_id').eq('id', row.team_id).single()
    const { data: owners } = await admin.from('team_members').select('user_id')
      .eq('team_id', row.team_id).eq('role', 'owner').eq('status', 'active')
    expect(team?.owner_user_id).toBe(userB!.id)
    expect(owners).toEqual([{ user_id: userB!.id }])
  }, 60_000)
})
