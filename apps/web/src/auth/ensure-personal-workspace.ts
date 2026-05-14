import type { SupabaseClient } from '@supabase/supabase-js'
import { createPersonalWorkspaceBootstrapPlan, type BootstrapUser } from './bootstrap'
import { getSupabaseBrowserClient } from '../lib/supabase'

export type PersonalWorkspaceBootstrapResult =
  | { ok: true; workspaceId: string; message: string }
  | { ok: false; message: string }

type ExistingWorkspace = { id: string }

export async function ensurePersonalWorkspace(client: SupabaseClient, user: BootstrapUser): Promise<PersonalWorkspaceBootstrapResult> {
  const plan = createPersonalWorkspaceBootstrapPlan({ user })

  const { error: profileError } = await client
    .from('profiles')
    .upsert(plan.profile, { onConflict: 'id' })

  if (profileError) {
    return { ok: false, message: `Profile bootstrap failed: ${profileError.message}` }
  }

  const { data: existingRows, error: workspaceLookupError } = await client
    .from('workspaces')
    .select('id')
    .eq('owner_user_id', user.id)
    .eq('type', 'personal')
    .limit(1)

  if (workspaceLookupError) {
    return { ok: false, message: `Workspace lookup failed: ${workspaceLookupError.message}` }
  }

  const existingWorkspace = (existingRows as ExistingWorkspace[] | null)?.[0]
  const workspaceId = existingWorkspace?.id ?? plan.workspace.id

  if (!existingWorkspace) {
    const { error: workspaceInsertError } = await client
      .from('workspaces')
      .insert(plan.workspace)

    if (workspaceInsertError) {
      return { ok: false, message: `Workspace bootstrap failed: ${workspaceInsertError.message}` }
    }
  }

  const { error: membershipError } = await client
    .from('workspace_members')
    .upsert({
      ...plan.membership,
      workspace_id: workspaceId,
    }, { onConflict: 'workspace_id,user_id' })

  if (membershipError) {
    return { ok: false, message: `Workspace membership bootstrap failed: ${membershipError.message}` }
  }

  return {
    ok: true,
    workspaceId,
    message: existingWorkspace
      ? 'Personal workspace confirmed.'
      : 'Personal workspace created.',
  }
}

export async function ensurePersonalWorkspaceForCurrentSession(user: BootstrapUser): Promise<PersonalWorkspaceBootstrapResult> {
  const client = getSupabaseBrowserClient()
  if (!client) return { ok: false, message: 'Supabase is not configured yet.' }
  return ensurePersonalWorkspace(client, user)
}
