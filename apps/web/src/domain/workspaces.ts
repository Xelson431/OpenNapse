import { z } from 'zod'

export type WorkspaceMode = 'personal' | 'team-preview'
export type WorkspaceType = 'personal' | 'team'

export type ActiveWorkspace = {
  id: string
  type: WorkspaceType
  mode: WorkspaceMode
  name: string
  badge: string
  description: string
  syncEnabled: boolean
}

export const LOCAL_PERSONAL_WORKSPACE_ID = 'local-personal-workspace'

export const workspaceTypeSchema = z.enum(['personal', 'team'])

export const workspaceRecordSchema = z.object({
  id: z.string().min(1),
  type: workspaceTypeSchema,
  name: z.string().trim().min(1).max(80),
  ownerUserId: z.string().min(1),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  isDefault: z.boolean().default(false),
})

export type WorkspaceRecord = z.infer<typeof workspaceRecordSchema>

export interface CreateWorkspaceInput {
  name: string
  type?: WorkspaceType
}

export const workspaceModes: Record<WorkspaceMode, { label: string; badge: string; description: string; disabled?: boolean }> = {
  personal: {
    label: 'Personal',
    badge: 'Private local',
    description: 'Personal workspaces are private by default. Your content is stored locally (and synced to your account if connected).',
  },
  'team-preview': {
    label: 'Team preview',
    badge: 'Locked until Supabase RLS',
    description: 'Team workspaces require authenticated cloud sync, workspace scoping, and Row Level Security before shared writes are enabled.',
    disabled: true,
  },
}

export function createActiveWorkspaceFromRecord(record: WorkspaceRecord): ActiveWorkspace {
  const mode: WorkspaceMode = record.type === 'team' ? 'team-preview' : 'personal'
  const modeMeta = workspaceModes[mode]
  return {
    id: record.id,
    type: record.type,
    mode,
    name: record.name,
    badge: record.type === 'team' ? 'Team · cloud required' : modeMeta.badge,
    description: modeMeta.description,
    syncEnabled: false,
  }
}

export function createActiveWorkspace(mode: WorkspaceMode): ActiveWorkspace {
  if (mode === 'team-preview') {
    return {
      id: 'team-preview-locked',
      type: 'team',
      mode,
      name: 'Team preview',
      badge: workspaceModes[mode].badge,
      description: workspaceModes[mode].description,
      syncEnabled: false,
    }
  }

  return {
    id: LOCAL_PERSONAL_WORKSPACE_ID,
    type: 'personal',
    mode: 'personal',
    name: 'Personal',
    badge: workspaceModes.personal.badge,
    description: workspaceModes.personal.description,
    syncEnabled: false,
  }
}

export function createWorkspaceRecord(input: CreateWorkspaceInput, ownerUserId: string): WorkspaceRecord {
  const now = new Date().toISOString()
  return workspaceRecordSchema.parse({
    id: crypto.randomUUID(),
    type: input.type ?? 'personal',
    name: input.name,
    ownerUserId,
    createdAt: now,
    updatedAt: now,
    isDefault: false,
  })
}

export function createDefaultPersonalWorkspaceRecord(ownerUserId: string): WorkspaceRecord {
  const now = new Date().toISOString()
  return workspaceRecordSchema.parse({
    id: LOCAL_PERSONAL_WORKSPACE_ID,
    type: 'personal',
    name: 'Personal',
    ownerUserId,
    createdAt: now,
    updatedAt: now,
    isDefault: true,
  })
}
