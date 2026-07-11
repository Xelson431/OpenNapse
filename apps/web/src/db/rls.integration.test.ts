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

  beforeAll(async () => {
    userA = await createTestUser('a')
    userB = await createTestUser('b')
  }, 60_000)

  afterAll(async () => {
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
    const { error: ownerRemovalError } = await userA!.client.from('workspace_members')
      .update({ status: 'removed' }).eq('workspace_id', userA!.workspaceId).eq('user_id', userA!.id)
    expect(ownerRemovalError).toBeTruthy()

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
})
