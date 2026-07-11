import { beforeEach, describe, expect, it } from 'vitest'
import { BrowserLocalAdapter } from './browser-local-adapter'
import { LocalStorageBackend } from './storage-backend'

describe('BrowserLocalAdapter sync foundation', () => {
  beforeEach(() => localStorage.clear())

  it('compacts repeated record writes while retaining the mutation id', async () => {
    const adapter = new BrowserLocalAdapter(new LocalStorageBackend())
    const idea = await adapter.createIdea({ title: 'Compacted idea' })
    const first = await adapter.listOutbox()
    await adapter.buryIdea(idea.id)
    const compacted = await adapter.listOutbox()
    expect(first).toHaveLength(1)
    expect(compacted).toHaveLength(1)
    expect(compacted[0].id).toBe(first[0].id)
    expect(compacted[0].operation).toBe('insert')
    expect(compacted[0].payload).toMatchObject({ id: idea.id, status: 'buried' })
  })

  it('exports all workspaces and stable logical IDs in export v2', async () => {
    const adapter = new BrowserLocalAdapter(new LocalStorageBackend())
    const second = await adapter.createWorkspace({ name: 'Second workspace' })
    await adapter.createIdea({ title: 'Personal idea' })
    adapter.setActiveWorkspaceId(second.id)
    await adapter.createIdea({ title: 'Second idea' })
    const exported = JSON.parse(await adapter.exportData()) as Record<string, unknown>
    expect(exported.exportVersion).toBe(2)
    expect(exported.workspaces).toEqual(expect.arrayContaining([expect.objectContaining({ id: second.id })]))
    expect(exported.ideas).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: 'Personal idea', logicalId: expect.any(String) }),
      expect.objectContaining({ title: 'Second idea', logicalId: expect.any(String) }),
    ]))
  })

  it('filters pending outbox mutations by active workspace', async () => {
    const adapter = new BrowserLocalAdapter(new LocalStorageBackend())
    const second = await adapter.createWorkspace({ name: 'Second workspace' })
    await adapter.createIdea({ title: 'Personal idea' })
    adapter.setActiveWorkspaceId(second.id)
    await adapter.createIdea({ title: 'Second idea' })
    expect(await adapter.listOutbox()).toEqual([expect.objectContaining({ workspaceId: second.id })])
  })
})
