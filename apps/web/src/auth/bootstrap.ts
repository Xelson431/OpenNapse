export type BootstrapUser = {
  id: string
  email?: string
}

export type ProfileBootstrapRow = {
  id: string
  email: string | null
  display_name: string
  created_at: string
  updated_at: string
}

export type WorkspaceBootstrapRow = {
  id: string
  type: 'personal'
  name: string
  owner_user_id: string
  created_at: string
  updated_at: string
}

export type WorkspaceMemberBootstrapRow = {
  workspace_id: string
  user_id: string
  role: 'owner'
  status: 'active'
  created_at: string
}

export type PersonalWorkspaceBootstrapPlan = {
  profile: ProfileBootstrapRow
  workspace: WorkspaceBootstrapRow
  membership: WorkspaceMemberBootstrapRow
}

function displayNameFromEmail(email?: string): string {
  if (!email) return 'Personal workspace'
  const name = email.split('@')[0]?.replace(/[._-]+/g, ' ').trim()
  return name ? `${name}'s workspace` : 'Personal workspace'
}

export function createPersonalWorkspaceBootstrapPlan(input: {
  user: BootstrapUser
  now?: string
  workspaceId?: string
}): PersonalWorkspaceBootstrapPlan {
  const now = input.now ?? new Date().toISOString()
  const workspaceId = input.workspaceId ?? crypto.randomUUID()
  const displayName = displayNameFromEmail(input.user.email)

  return {
    profile: {
      id: input.user.id,
      email: input.user.email ?? null,
      display_name: displayName,
      created_at: now,
      updated_at: now,
    },
    workspace: {
      id: workspaceId,
      type: 'personal',
      name: 'Personal',
      owner_user_id: input.user.id,
      created_at: now,
      updated_at: now,
    },
    membership: {
      workspace_id: workspaceId,
      user_id: input.user.id,
      role: 'owner',
      status: 'active',
      created_at: now,
    },
  }
}
