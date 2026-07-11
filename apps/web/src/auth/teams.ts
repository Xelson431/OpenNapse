import { getSupabaseBrowserClient } from '../lib/supabase'

export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'viewer'
export type InviteRole = 'admin' | 'member' | 'viewer'

export interface WorkspaceMember {
  userId: string
  role: WorkspaceRole
  status: 'active' | 'removed' | 'pending'
  email?: string
  joinedAt: string
}

export interface WorkspaceInvite {
  id: string
  workspaceId: string
  email: string
  role: InviteRole
  status: 'pending' | 'accepted' | 'declined' | 'expired' | 'revoked'
  expiresAt: string
  createdAt: string
}

export type TeamsOperationResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string }

function cloud() {
  const client = getSupabaseBrowserClient()
  if (!client) throw new Error('Supabase is not configured; cloud teams are unavailable.')
  return client
}

export async function listWorkspaceMembers(workspaceId: string): Promise<TeamsOperationResult<WorkspaceMember[]>> {
  try {
    const client = cloud()
    const { data, error } = await client
      .from('workspace_members')
      .select('user_id, role, status, created_at, profiles:profiles!inner(email)')
      .eq('workspace_id', workspaceId)
    if (error) return { ok: false, error: error.message }
    const rows = (data ?? []) as Array<{
      user_id: string
      role: WorkspaceRole
      status: 'active' | 'removed' | 'pending'
      created_at: string
      profiles?: { email?: string | null } | null
    }>
    const members: WorkspaceMember[] = rows.map((row) => ({
      userId: row.user_id,
      role: row.role,
      status: row.status,
      email: row.profiles?.email ?? undefined,
      joinedAt: row.created_at,
    }))
    return { ok: true, data: members }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function listWorkspaceInvites(workspaceId: string): Promise<TeamsOperationResult<WorkspaceInvite[]>> {
  try {
    const client = cloud()
    const { data, error } = await client
      .from('workspace_invites')
      .select('id, workspace_id, email, role, status, expires_at, created_at')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
    if (error) return { ok: false, error: error.message }
    const invites: WorkspaceInvite[] = ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      id: row.id as string,
      workspaceId: row.workspace_id as string,
      email: row.email as string,
      role: row.role as InviteRole,
      status: row.status as WorkspaceInvite['status'],
      expiresAt: row.expires_at as string,
      createdAt: row.created_at as string,
    }))
    return { ok: true, data: invites }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function inviteWorkspaceMember(workspaceId: string, email: string, role: InviteRole): Promise<TeamsOperationResult<{ inviteId: string; token: string }>> {
  try {
    const client = cloud()
    const { data: sessionData } = await client.auth.getSession()
    const accessToken = sessionData.session?.access_token
    if (!accessToken) return { ok: false, error: 'Sign in before sending invites.' }
    const { data, error } = await client.functions.invoke('invite-member', {
      body: { workspaceId, email, role },
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (error) return { ok: false, error: error.message }
    const payload = data as { ok: boolean; invite?: { id: string }; token?: string; error?: string } | null
    if (!payload?.ok || !payload.invite || !payload.token) {
      return { ok: false, error: payload?.error ?? 'Invite failed.' }
    }
    return { ok: true, data: { inviteId: payload.invite.id, token: payload.token } }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function revokeWorkspaceInvite(inviteId: string): Promise<TeamsOperationResult<true>> {
  try {
    const client = cloud()
    const { error } = await client.from('workspace_invites').update({ status: 'revoked' }).eq('id', inviteId)
    if (error) return { ok: false, error: error.message }
    return { ok: true, data: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function removeWorkspaceMember(workspaceId: string, userId: string): Promise<TeamsOperationResult<true>> {
  try {
    const client = cloud()
    const { error } = await client.rpc('remove_workspace_member', {
      target_workspace_id: workspaceId,
      target_user_id: userId,
    })
    if (error) return { ok: false, error: error.message }
    return { ok: true, data: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function acceptInvite(token: string): Promise<TeamsOperationResult<{ workspaceId: string; role: WorkspaceRole }>> {
  try {
    const client = cloud()
    const { data: sessionData } = await client.auth.getSession()
    const accessToken = sessionData.session?.access_token
    if (!accessToken) return { ok: false, error: 'Sign in before accepting invites.' }
    const { data, error } = await client.functions.invoke('accept-invite', {
      body: { token },
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (error) return { ok: false, error: error.message }
    const payload = data as { ok: boolean; workspaceId?: string; role?: WorkspaceRole; error?: string } | null
    if (!payload?.ok || !payload.workspaceId || !payload.role) {
      return { ok: false, error: payload?.error ?? 'Invite acceptance failed.' }
    }
    return { ok: true, data: { workspaceId: payload.workspaceId, role: payload.role } }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
