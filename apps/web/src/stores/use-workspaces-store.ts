import { create } from 'zustand'
import { assertDbSnapshotCurrent, captureDbSnapshot, getDb } from '../db/get-db'
import type { DBAdapter } from '../db/adapter'
import { logger } from '../lib/logger'
import { assertWriteAllowed } from '../lib/rate-limiter'
import { LOCAL_PERSONAL_WORKSPACE_ID, type CreateWorkspaceInput, type WorkspaceRecord } from '../domain/workspaces'

const ACTIVE_WORKSPACE_KEY = 'OpenNapse:v0:active-workspace-id'
export type WorkspacePreferenceScope = 'local' | `cloud:${string}:${string}`

export function cloudWorkspacePreferenceScope(projectHost: string, userId: string): WorkspacePreferenceScope {
  return `cloud:${projectHost}:${userId}`
}

function scopedActiveWorkspaceKey(scope: WorkspacePreferenceScope): string {
  return `${ACTIVE_WORKSPACE_KEY}:${scope}`
}

export function readActiveWorkspaceId(scope: WorkspacePreferenceScope = 'local'): string {
  if (typeof window === 'undefined') return LOCAL_PERSONAL_WORKSPACE_ID
  try {
    // The old key is intentionally migration-only. Never write it again: a
    // cloud validation must not replace a local user's selection (or vice versa).
    const stored = localStorage.getItem(scopedActiveWorkspaceKey(scope)) ?? localStorage.getItem(ACTIVE_WORKSPACE_KEY)
    return stored && stored.length > 0 ? stored : LOCAL_PERSONAL_WORKSPACE_ID
  } catch {
    logger.warn('local', 'readActiveWorkspaceId failed, falling back to default')
    return LOCAL_PERSONAL_WORKSPACE_ID
  }
}

export function writeActiveWorkspaceId(scope: WorkspacePreferenceScope, workspaceId: string): void {
  try {
    localStorage.setItem(scopedActiveWorkspaceKey(scope), workspaceId)
  } catch {
    logger.warn('local', 'writeActiveWorkspaceId failed, unable to persist active workspace')
  }
}

type WorkspaceLoadOptions = {
  adapter?: DBAdapter
  scope?: WorkspacePreferenceScope
  fallbackWorkspaceId?: string
  shouldCommit?: () => boolean
  onBeforeCommit?: () => boolean | void
}

type WorkspaceSelectionOptions = { adapter?: DBAdapter; scope?: WorkspacePreferenceScope }

interface WorkspacesState {
  workspaces: WorkspaceRecord[]
  activeWorkspaceId: string
  isLoaded: boolean
  loadWorkspaces: (options?: WorkspaceLoadOptions) => Promise<string | null>
  setActiveWorkspace: (workspaceId: string, options?: WorkspaceSelectionOptions) => void
  createWorkspace: (input: CreateWorkspaceInput) => Promise<WorkspaceRecord>
  renameWorkspace: (workspaceId: string, name: string) => Promise<void>
  deleteWorkspace: (workspaceId: string, options?: WorkspaceSelectionOptions) => Promise<void>
}

export const useWorkspacesStore = create<WorkspacesState>((set, get) => ({
  workspaces: [],
  activeWorkspaceId: readActiveWorkspaceId(),
  isLoaded: false,
  loadWorkspaces: async (options = {}) => {
    const adapter = options.adapter ?? getDb()
    const scope = options.scope ?? 'local'
    const workspaces = await adapter.listWorkspaces()
    if (options.shouldCommit && !options.shouldCommit()) return null
    const stored = readActiveWorkspaceId(scope)
    const exists = workspaces.some((w) => w.id === stored)
    const fallbackExists = options.fallbackWorkspaceId && workspaces.some((w) => w.id === options.fallbackWorkspaceId)
    const active = exists ? stored : (fallbackExists ? options.fallbackWorkspaceId! : workspaces.find((w) => w.id === LOCAL_PERSONAL_WORKSPACE_ID)?.id ?? workspaces[0]?.id ?? LOCAL_PERSONAL_WORKSPACE_ID)
    adapter.setActiveWorkspaceId(active)
    if (options.shouldCommit && !options.shouldCommit()) return null
    if (options.onBeforeCommit?.() === false) return null
    if (options.shouldCommit && !options.shouldCommit()) return null
    writeActiveWorkspaceId(scope, active)
    set({ workspaces, activeWorkspaceId: active, isLoaded: true })
    return active
  },
  setActiveWorkspace: (workspaceId, options = {}) => {
    const snapshot = captureDbSnapshot()
    const adapter = options.adapter ?? getDb()
    if (adapter !== snapshot.adapter) throw new Error('Storage adapter changed while selecting a workspace.')
    writeActiveWorkspaceId(options.scope ?? 'local', workspaceId)
    adapter.setActiveWorkspaceId(workspaceId)
    set({ activeWorkspaceId: workspaceId })
  },
  createWorkspace: async (input) => {
    const snapshot = captureDbSnapshot()
    assertWriteAllowed('workspaceMutation')
    const record = await snapshot.adapter.createWorkspace(input)
    assertDbSnapshotCurrent(snapshot)
    set({ workspaces: [...get().workspaces, record] })
    return record
  },
  renameWorkspace: async (workspaceId, name) => {
    const snapshot = captureDbSnapshot()
    assertWriteAllowed('workspaceMutation')
    const updated = await snapshot.adapter.renameWorkspace(workspaceId, name)
    assertDbSnapshotCurrent(snapshot)
    set({ workspaces: get().workspaces.map((w) => (w.id === workspaceId ? updated : w)) })
  },
  deleteWorkspace: async (workspaceId, options = {}) => {
    const snapshot = captureDbSnapshot()
    assertWriteAllowed('workspaceMutation')
    const adapter = options.adapter ?? getDb()
    if (adapter !== snapshot.adapter) throw new Error('Storage adapter changed while deleting a workspace.')
    const activeWorkspaceId = get().activeWorkspaceId
    await adapter.deleteWorkspace(workspaceId)
    assertDbSnapshotCurrent(snapshot)
    const remaining = get().workspaces.filter((w) => w.id !== workspaceId)
    if (workspaceId !== activeWorkspaceId) {
      set({ workspaces: remaining })
      return
    }
    const nextActive = remaining[0]?.id ?? LOCAL_PERSONAL_WORKSPACE_ID
    writeActiveWorkspaceId(options.scope ?? 'local', nextActive)
    adapter.setActiveWorkspaceId(nextActive)
    set({ workspaces: remaining, activeWorkspaceId: nextActive })
  },
}))
