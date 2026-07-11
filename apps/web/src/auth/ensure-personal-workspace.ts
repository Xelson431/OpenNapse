import type { SupabaseClient } from '@supabase/supabase-js'
import { createPersonalWorkspaceBootstrapPlan, type BootstrapUser } from './bootstrap'
import { getSupabaseBrowserClient } from '../lib/supabase'
import { logger } from '../lib/logger'

export type PersonalWorkspaceBootstrapResult =
  | { ok: true; workspaceId: string; message: string }
  | { ok: false; message: string }

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

  logger.debug('bootstrap', 'Ensuring transactional personal workspace')
  const { data, error } = await client.rpc('create_workspace', {
    requested_name: plan.workspace.name,
    requested_type: 'personal',
    idempotency_key: plan.workspace.id,
  })
  const row = (data as Array<{ workspace_id: string; created: boolean }> | null)?.[0]
  if (error || !row) {
    logger.error('bootstrap', 'Transactional workspace bootstrap failed', { error: error?.message })
    return { ok: false, message: `Workspace bootstrap failed: ${error?.message ?? 'No workspace returned.'}` }
  }

  logger.info('bootstrap', 'Bootstrap completed successfully', { workspaceId: row.workspace_id, created: row.created })
  return {
    ok: true,
    workspaceId: row.workspace_id,
    message: row.created ? 'Personal workspace created.' : 'Personal workspace confirmed.',
  }
}

export async function ensurePersonalWorkspaceForCurrentSession(user: BootstrapUser): Promise<PersonalWorkspaceBootstrapResult> {
  const client = getSupabaseBrowserClient()
  if (!client) return { ok: false, message: 'Supabase is not configured yet.' }
  return ensurePersonalWorkspace(client, user)
}
