import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DBAdapter } from '../db/adapter'
import { beginDbTransition, cancelDbTransition, commitDbTransition, getDb, setDb } from '../db/get-db'
import { LOCAL_PERSONAL_WORKSPACE_ID, type WorkspaceRecord } from '../domain/workspaces'
import { cloudWorkspacePreferenceScope, useWorkspacesStore } from './use-workspaces-store'

const localWorkspace: WorkspaceRecord = { id: LOCAL_PERSONAL_WORKSPACE_ID, name: 'Personal', type: 'personal', ownerUserId: 'local-user', isDefault: true, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }
const cloudWorkspace: WorkspaceRecord = { ...localWorkspace, id: 'cloud-workspace', name: 'Cloud workspace' }

function adapter(workspaces: WorkspaceRecord[]) {
  return {
    listWorkspaces: vi.fn().mockResolvedValue(workspaces),
    setActiveWorkspaceId: vi.fn(),
    deleteWorkspace: vi.fn().mockResolvedValue(undefined),
  } as unknown as DBAdapter
}

beforeEach(() => {
  localStorage.clear()
  useWorkspacesStore.setState({ workspaces: [], activeWorkspaceId: LOCAL_PERSONAL_WORKSPACE_ID, isLoaded: false })
})

describe('workspace preference scopes', () => {
  it('keeps local and cloud selections isolated', async () => {
    const local = adapter([localWorkspace, { ...localWorkspace, id: 'local-second', name: 'Local second' }])
    const cloud = adapter([cloudWorkspace])
    const scope = cloudWorkspacePreferenceScope('project.supabase.co', 'user-1')

    setDb(local)
    useWorkspacesStore.getState().setActiveWorkspace('local-second', { adapter: local, scope: 'local' })
    await useWorkspacesStore.getState().loadWorkspaces({ adapter: cloud, scope, fallbackWorkspaceId: cloudWorkspace.id })

    expect(localStorage.getItem('OpenNapse:v0:active-workspace-id:local')).toBe('local-second')
    expect(localStorage.getItem(`OpenNapse:v0:active-workspace-id:${scope}`)).toBe('cloud-workspace')
    expect(localStorage.getItem('OpenNapse:v0:active-workspace-id')).toBeNull()
  })

  it('uses the legacy preference only as a scoped migration fallback', async () => {
    localStorage.setItem('OpenNapse:v0:active-workspace-id', cloudWorkspace.id)
    const cloud = adapter([cloudWorkspace])
    const scope = cloudWorkspacePreferenceScope('project.supabase.co', 'user-1')

    await useWorkspacesStore.getState().loadWorkspaces({ adapter: cloud, scope, fallbackWorkspaceId: 'personal-bootstrap' })

    expect(cloud.setActiveWorkspaceId).toHaveBeenCalledWith(cloudWorkspace.id)
    expect(localStorage.getItem('OpenNapse:v0:active-workspace-id')).toBe(cloudWorkspace.id)
    expect(localStorage.getItem(`OpenNapse:v0:active-workspace-id:${scope}`)).toBe(cloudWorkspace.id)
  })

  it('preserves the active selection when deleting another workspace', async () => {
    const db = adapter([localWorkspace, cloudWorkspace])
    setDb(db)
    useWorkspacesStore.setState({ workspaces: [localWorkspace, cloudWorkspace], activeWorkspaceId: cloudWorkspace.id, isLoaded: true })
    useWorkspacesStore.getState().setActiveWorkspace(cloudWorkspace.id, { adapter: db, scope: 'local' })

    await useWorkspacesStore.getState().deleteWorkspace(localWorkspace.id, { adapter: db, scope: 'local' })

    expect(useWorkspacesStore.getState().activeWorkspaceId).toBe(cloudWorkspace.id)
    expect(localStorage.getItem('OpenNapse:v0:active-workspace-id:local')).toBe(cloudWorkspace.id)
    expect(db.setActiveWorkspaceId).toHaveBeenLastCalledWith(cloudWorkspace.id)
  })

  it('falls back and rewrites a revoked workspace preference', async () => {
    const db = adapter([localWorkspace])
    localStorage.setItem('OpenNapse:v0:active-workspace-id:local', 'revoked-workspace')

    await useWorkspacesStore.getState().loadWorkspaces({ adapter: db, scope: 'local' })

    expect(useWorkspacesStore.getState().activeWorkspaceId).toBe(LOCAL_PERSONAL_WORKSPACE_ID)
    expect(localStorage.getItem('OpenNapse:v0:active-workspace-id:local')).toBe(LOCAL_PERSONAL_WORKSPACE_ID)
  })

  it('suppresses stale workspace loads and blocks selection during a transition', async () => {
    let resolve!: (workspaces: WorkspaceRecord[]) => void
    const stale = adapter([])
    vi.mocked(stale.listWorkspaces).mockImplementationOnce(() => new Promise((done) => { resolve = done }))
    const current = adapter([cloudWorkspace])
    const staleLoad = useWorkspacesStore.getState().loadWorkspaces({ adapter: stale, scope: 'local', shouldCommit: () => false })

    const transition = beginDbTransition()
    expect(() => useWorkspacesStore.getState().setActiveWorkspace(cloudWorkspace.id)).toThrow(/transitioning/)
    expect(commitDbTransition(current, transition)).toBe(true)
    resolve([localWorkspace])
    await staleLoad

    expect(useWorkspacesStore.getState().workspaces).toEqual([])
  })

  it('throws when workspace creation completes on a replaced adapter', async () => {
    let resolve!: (workspace: WorkspaceRecord) => void
    const stale = adapter([])
    const createWorkspace = vi.fn().mockImplementationOnce(() => new Promise<WorkspaceRecord>((done) => { resolve = done }))
    Object.assign(stale, { createWorkspace })
    const current = adapter([cloudWorkspace])
    setDb(stale)

    const creation = useWorkspacesStore.getState().createWorkspace({ name: 'Stale workspace', type: 'personal' })
    setDb(current)
    resolve({ ...cloudWorkspace, id: 'stale-workspace', name: 'Stale workspace' })

    await expect(creation).rejects.toThrow(/Storage adapter changed while completing the operation/)
    expect(useWorkspacesStore.getState().workspaces).toEqual([])
  })

  it('cannot commit an adapter after its transition is cancelled', async () => {
    const previous = adapter([localWorkspace])
    const pending = adapter([cloudWorkspace])
    setDb(previous)
    const transition = beginDbTransition()

    cancelDbTransition(transition)
    const active = await useWorkspacesStore.getState().loadWorkspaces({
      adapter: pending,
      scope: cloudWorkspacePreferenceScope('project.supabase.co', 'user-1'),
      onBeforeCommit: () => commitDbTransition(pending, transition),
    })

    expect(active).toBeNull()
    expect(getDb()).toBe(previous)
  })
})
