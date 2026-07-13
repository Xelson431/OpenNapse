import { getSupabaseBrowserClient } from '../lib/supabase'

export type TeamRole = 'owner' | 'admin' | 'member' | 'viewer'

export interface Team {
  id: string
  name: string
  ownerUserId: string
  createdAt: string
}

export interface TeamMember {
  userId: string
  role: TeamRole
  status: 'active' | 'removed'
  email?: string
}

export type TeamResult<T> = { ok: true; data: T } | { ok: false; error: string }

function cloud() {
  const client = getSupabaseBrowserClient()
  if (!client) throw new Error('Supabase is not configured; teams require a cloud backend.')
  return client
}

export async function listTeams(): Promise<TeamResult<Team[]>> {
  try {
    const { data, error } = await cloud()
      .from('teams')
      .select('id, name, owner_user_id, created_at')
      .order('created_at', { ascending: true })
    if (error) return { ok: false, error: error.message }
    const teams = ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      id: row.id as string,
      name: row.name as string,
      ownerUserId: row.owner_user_id as string,
      createdAt: row.created_at as string,
    }))
    return { ok: true, data: teams }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function createTeam(name: string): Promise<TeamResult<{ teamId: string }>> {
  try {
    const { data, error } = await cloud().rpc('create_team', { requested_name: name.trim() })
    const row = (data as Array<{ team_id: string }> | null)?.[0]
    if (error || !row) return { ok: false, error: error?.message ?? 'Team creation failed.' }
    return { ok: true, data: { teamId: row.team_id } }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function listTeamMembers(teamId: string): Promise<TeamResult<TeamMember[]>> {
  try {
    const { data, error } = await cloud()
      .from('team_members')
      .select('user_id, role, status, profiles:profiles!inner(email)')
      .eq('team_id', teamId)
      .eq('status', 'active')
    if (error) return { ok: false, error: error.message }
    const members = ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      userId: row.user_id as string,
      role: row.role as TeamRole,
      status: row.status as TeamMember['status'],
      email: (row.profiles as { email?: string } | null)?.email,
    }))
    return { ok: true, data: members }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function addTeamMember(teamId: string, userId: string, role: Exclude<TeamRole, 'owner'>): Promise<TeamResult<true>> {
  try {
    const { error } = await cloud().rpc('add_team_member', { target_team_id: teamId, target_user_id: userId, member_role: role })
    if (error) return { ok: false, error: error.message }
    return { ok: true, data: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function removeTeamMember(teamId: string, userId: string): Promise<TeamResult<true>> {
  try {
    const { error } = await cloud().rpc('remove_team_member', { target_team_id: teamId, target_user_id: userId })
    if (error) return { ok: false, error: error.message }
    return { ok: true, data: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function attachTeamToWorkspace(teamId: string, workspaceId: string): Promise<TeamResult<true>> {
  try {
    const { error } = await cloud().rpc('attach_team_to_workspace', { target_team_id: teamId, target_workspace_id: workspaceId })
    if (error) return { ok: false, error: error.message }
    return { ok: true, data: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function detachTeamFromWorkspace(teamId: string, workspaceId: string): Promise<TeamResult<true>> {
  try {
    const { error } = await cloud().rpc('detach_team_from_workspace', { target_team_id: teamId, target_workspace_id: workspaceId })
    if (error) return { ok: false, error: error.message }
    return { ok: true, data: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
