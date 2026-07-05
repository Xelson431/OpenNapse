import { create } from 'zustand'
import { getDb } from '../db/get-db'
import { assertWriteAllowed } from '../lib/rate-limiter'
import { LOCAL_PERSONAL_WORKSPACE_ID, type CreateWorkspaceInput, type WorkspaceRecord } from '../domain/workspaces'

const ACTIVE_WORKSPACE_KEY = 'OpenNapse:v0:active-workspace-id'

function readActiveWorkspaceId(): string {
  if (typeof window === 'undefined') return LOCAL_PERSONAL_WORKSPACE_ID
  try {
    const stored = localStorage.getItem(ACTIVE_WORKSPACE_KEY)
    return stored && stored.length > 0 ? stored : LOCAL_PERSONAL_WORKSPACE_ID
  } catch {
    return LOCAL_PERSONAL_WORKSPACE_ID
  }
}

function writeActiveWorkspaceId(workspaceId: string): void {
  try {
    localStorage.setItem(ACTIVE_WORKSPACE_KEY, workspaceId)
  } catch {
    // ignore storage write failures
  }
}

interface WorkspacesState {
  workspaces: WorkspaceRecord[]
  activeWorkspaceId: string
  isLoaded: boolean
  loadWorkspaces: () => Promise<void>
  setActiveWorkspace: (workspaceId: string) => void
  createWorkspace: (input: CreateWorkspaceInput) => Promise<WorkspaceRecord>
  renameWorkspace: (workspaceId: string, name: string) => Promise<void>
  deleteWorkspace: (workspaceId: string) => Promise<void>
}

export const useWorkspacesStore = create<WorkspacesState>((set, get) => ({
  workspaces: [],
  activeWorkspaceId: readActiveWorkspaceId(),
  isLoaded: false,
  loadWorkspaces: async () => {
    const workspaces = await getDb().listWorkspaces()
    const stored = get().activeWorkspaceId
    const exists = workspaces.some((w) => w.id === stored)
    const active = exists ? stored : workspaces[0]?.id ?? LOCAL_PERSONAL_WORKSPACE_ID
    if (active !== stored) {
      writeActiveWorkspaceId(active)
    }
    getDb().setActiveWorkspaceId(active)
    set({ workspaces, activeWorkspaceId: active, isLoaded: true })
  },
  setActiveWorkspace: (workspaceId) => {
    writeActiveWorkspaceId(workspaceId)
    getDb().setActiveWorkspaceId(workspaceId)
    set({ activeWorkspaceId: workspaceId })
  },
  createWorkspace: async (input) => {
    assertWriteAllowed('workspaceMutation')
    const record = await getDb().createWorkspace(input)
    set({ workspaces: [...get().workspaces, record] })
    return record
  },
  renameWorkspace: async (workspaceId, name) => {
    assertWriteAllowed('workspaceMutation')
    const updated = await getDb().renameWorkspace(workspaceId, name)
    set({ workspaces: get().workspaces.map((w) => (w.id === workspaceId ? updated : w)) })
  },
  deleteWorkspace: async (workspaceId) => {
    assertWriteAllowed('workspaceMutation')
    await getDb().deleteWorkspace(workspaceId)
    const remaining = get().workspaces.filter((w) => w.id !== workspaceId)
    const nextActive = remaining[0]?.id ?? LOCAL_PERSONAL_WORKSPACE_ID
    writeActiveWorkspaceId(nextActive)
    getDb().setActiveWorkspaceId(nextActive)
    set({ workspaces: remaining, activeWorkspaceId: nextActive })
  },
}))
