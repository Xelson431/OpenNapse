import type { SupabaseClient } from '@supabase/supabase-js'
import { createPersonalWorkspaceBootstrapPlan, type BootstrapUser } from './bootstrap'
import { getSupabaseBrowserClient } from '../lib/supabase'
import { logger } from '../lib/logger'

export type PersonalWorkspaceBootstrapResult =
  | { ok: true; workspaceId: string; message: string }
  | { ok: false; message: string }

type ExistingWorkspace = { id: string }

export async function ensurePersonalWorkspace(client: SupabaseClient, user: BootstrapUser): Promise<PersonalWorkspaceBootstrapResult> {
  const plan = createPersonalWorkspaceBootstrapPlan({ user })

  logger.debug('bootstrap', 'Upserting profile')
  const { error: profileError } = await client
    .from('profiles')
    .upsert(plan.profile, { onConflict: 'id' })

  if (profileError) {
    logger.error('bootstrap', `Profile upsert failed`, { error: profileError.message })
    return { ok: false, message: `Profile bootstrap failed: ${profileError.message}` }
  }

  logger.debug('bootstrap', 'Looking up existing personal workspace')
  const { data: existingRows, error: workspaceLookupError } = await client
    .from('workspaces')
    .select('id')
    .eq('owner_user_id', user.id)
    .eq('type', 'personal')
    .limit(1)

  if (workspaceLookupError) {
    logger.error('bootstrap', `Workspace lookup failed`, { error: workspaceLookupError.message })
    return { ok: false, message: `Workspace lookup failed: ${workspaceLookupError.message}` }
  }

  const existingWorkspace = (existingRows as ExistingWorkspace[] | null)?.[0]
  const workspaceId = existingWorkspace?.id ?? plan.workspace.id

  if (!existingWorkspace) {
    logger.debug('bootstrap', 'Creating new personal workspace')
    const { error: workspaceInsertError } = await client
      .from('workspaces')
      .insert(plan.workspace)

    if (workspaceInsertError) {
      logger.error('bootstrap', `Workspace insert failed`, { error: workspaceInsertError.message })
      return { ok: false, message: `Workspace bootstrap failed: ${workspaceInsertError.message}` }
    }
  } else {
    logger.debug('bootstrap', 'Personal workspace already exists', { workspaceId })
  }

  logger.debug('bootstrap', 'Upserting workspace membership')
  const { error: membershipError } = await client
    .from('workspace_members')
    .upsert({
      ...plan.membership,
      workspace_id: workspaceId,
    }, { onConflict: 'workspace_id,user_id' })

  if (membershipError) {
    logger.error('bootstrap', `Membership upsert failed`, { error: membershipError.message })
    return { ok: false, message: `Workspace membership bootstrap failed: ${membershipError.message}` }
  }

  logger.info('bootstrap', 'Bootstrap completed successfully', { workspaceId, existing: !!existingWorkspace })
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
