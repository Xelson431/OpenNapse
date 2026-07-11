import { getSupabaseBrowserClient } from '../lib/supabase'

export type DeletionRequest = {
  id: string
  scope: 'workspace' | 'account'
  workspaceId: string | null
  status: 'pending' | 'cancelled' | 'approved' | 'executing' | 'completed' | 'failed'
  scheduledFor: string
  createdAt: string
}

function cloud() {
  const client = getSupabaseBrowserClient()
  if (!client) throw new Error('Supabase is not configured; hosted lifecycle controls are unavailable.')
  return client
}

export async function requestDeletion(scope: 'workspace' | 'account', workspaceId?: string): Promise<{ requestId: string; confirmationToken: string; scheduledFor: string }> {
  const { data, error } = await cloud().rpc('request_deletion', {
    requested_scope: scope,
    target_workspace_id: scope === 'workspace' ? workspaceId : null,
  })
  const row = (data as Array<{ request_id: string; confirmation_token: string; scheduled_for: string }> | null)?.[0]
  if (error || !row) throw new Error(`Deletion request failed: ${error?.message ?? 'No request returned.'}`)
  return { requestId: row.request_id, confirmationToken: row.confirmation_token, scheduledFor: row.scheduled_for }
}

export async function cancelDeletion(requestId: string, confirmationToken: string): Promise<void> {
  const { error } = await cloud().rpc('cancel_deletion', {
    target_request_id: requestId,
    supplied_token: confirmationToken,
  })
  if (error) throw new Error(`Deletion cancellation failed: ${error.message}`)
}

export async function listDeletionRequests(): Promise<DeletionRequest[]> {
  const { data, error } = await cloud().from('deletion_requests').select('id,scope,workspace_id,status,scheduled_for,created_at').order('created_at', { ascending: false })
  if (error) throw new Error(`Deletion request lookup failed: ${error.message}`)
  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id), scope: row.scope === 'account' ? 'account' : 'workspace', workspaceId: typeof row.workspace_id === 'string' ? row.workspace_id : null,
    status: row.status as DeletionRequest['status'], scheduledFor: String(row.scheduled_for), createdAt: String(row.created_at),
  }))
}

export async function transferWorkspaceOwnership(workspaceId: string, newOwnerUserId: string): Promise<void> {
  const { error } = await cloud().rpc('transfer_workspace_ownership', { target_workspace_id: workspaceId, new_owner_user_id: newOwnerUserId })
  if (error) throw new Error(`Ownership transfer failed: ${error.message}`)
}
