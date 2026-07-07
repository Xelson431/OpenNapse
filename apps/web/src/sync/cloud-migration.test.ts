import { describe, expect, it, vi } from 'vitest'
import type { DBAdapter } from '../db/adapter'
import { countExportPayload, hasExportedContent, migrateLocalDataToCloud } from './cloud-migration'

function createAdapter(overrides: Partial<DBAdapter> = {}): DBAdapter {
  return {
    setActiveWorkspaceId: vi.fn(),
    listWorkspaces: vi.fn().mockResolvedValue([]),
    createWorkspace: vi.fn(),
    renameWorkspace: vi.fn(),
    deleteWorkspace: vi.fn(),
    listIdeas: vi.fn().mockResolvedValue([]),
    createIdea: vi.fn(),
    buryIdea: vi.fn(),
    resurrectIdea: vi.fn(),
    moveIdeaToProject: vi.fn(),
    listProjects: vi.fn().mockResolvedValue([]),
    createProject: vi.fn(),
    listTasks: vi.fn().mockResolvedValue([]),
    listNotes: vi.fn().mockResolvedValue([]),
    createTask: vi.fn(),
    promoteIdea: vi.fn(),
    moveTask: vi.fn(),
    updateTask: vi.fn(),
    upsertNote: vi.fn(),
    deleteNote: vi.fn(),
    exportData: vi.fn().mockResolvedValue(JSON.stringify({ ideas: [], projects: [], tasks: [], notes: [] })),
    importData: vi.fn().mockResolvedValue(undefined),
    clearAllData: vi.fn(),
    listOutbox: vi.fn().mockResolvedValue([]),
    ...overrides,
  }
}

describe('cloud migration helpers', () => {
  it('counts exported records safely', () => {
    expect(countExportPayload(JSON.stringify({ ideas: [1], projects: [1, 2], tasks: [], notes: [1] }))).toEqual({ ideas: 1, projects: 2, tasks: 0, notes: 1 })
    expect(countExportPayload('not-json')).toEqual({ ideas: 0, projects: 0, tasks: 0, notes: 0 })
  })

  it('detects whether exported payload has content', () => {
    expect(hasExportedContent({ ideas: 0, projects: 0, tasks: 0, notes: 0 })).toBe(false)
    expect(hasExportedContent({ ideas: 0, projects: 1, tasks: 0, notes: 0 })).toBe(true)
  })

  it('imports local payload into cloud when cloud is empty', async () => {
    const payload = JSON.stringify({ ideas: [{ id: '1' }], projects: [], tasks: [], notes: [] })
    const localAdapter = createAdapter({ exportData: vi.fn().mockResolvedValue(payload) })
    const cloudAdapter = createAdapter()

    const counts = await migrateLocalDataToCloud(localAdapter, cloudAdapter)

    expect(counts).toEqual({ ideas: 1, projects: 0, tasks: 0, notes: 0 })
    expect(localAdapter.exportData).toHaveBeenCalledOnce()
    expect(cloudAdapter.listIdeas).toHaveBeenCalledOnce()
    expect(cloudAdapter.importData).toHaveBeenCalledWith(payload)
  })

  it('does not import when cloud already has data', async () => {
    const localAdapter = createAdapter({ exportData: vi.fn().mockResolvedValue(JSON.stringify({ ideas: [{ id: '1' }], projects: [], tasks: [], notes: [] })) })
    const cloudAdapter = createAdapter({ listIdeas: vi.fn().mockResolvedValue([{ id: 'cloud' }]) })

    await migrateLocalDataToCloud(localAdapter, cloudAdapter)

    expect(cloudAdapter.importData).not.toHaveBeenCalled()
  })
})
