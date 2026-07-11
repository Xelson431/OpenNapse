import { describe, expect, it } from 'vitest'
import { buildSyncPushRequest, syncProtocolLimits } from './protocol'

describe('sync protocol', () => {
  it('builds workspace-scoped idempotent mutations', () => {
    const request = buildSyncPushRequest('workspace-a', [
      { id: 'mutation-a', workspaceId: 'workspace-a', tableName: 'ideas', recordId: 'record-a', operation: 'update', payload: { logicalId: 'logical-a', version: 3 }, createdAt: '', retryCount: 0, lastError: null },
      { id: 'mutation-b', workspaceId: 'workspace-b', tableName: 'notes', recordId: 'record-b', operation: 'insert', payload: { version: 1 }, createdAt: '', retryCount: 0, lastError: null },
      { id: 'backup', workspaceId: 'workspace-a', tableName: 'backup', recordId: 'backup-a', operation: 'insert', payload: {}, createdAt: '', retryCount: 0, lastError: null },
    ])

    expect(request).toEqual({
      workspaceId: 'workspace-a',
      mutations: [{ mutationId: 'mutation-a', entityType: 'ideas', logicalId: 'logical-a', operation: 'upsert', expectedVersion: 2, payload: { logicalId: 'logical-a', version: 3 } }],
    })
  })

  it('caps each push batch', () => {
    const entries = Array.from({ length: syncProtocolLimits.maxMutationsPerRequest + 5 }, (_, index) => ({
      id: crypto.randomUUID(), workspaceId: 'workspace-a', tableName: 'ideas' as const, recordId: crypto.randomUUID(),
      operation: 'insert' as const, payload: { title: `Idea ${index}`, version: 1 }, createdAt: new Date().toISOString(), retryCount: 0, lastError: null,
    }))
    expect(buildSyncPushRequest('workspace-a', entries).mutations).toHaveLength(syncProtocolLimits.maxMutationsPerRequest)
  })
})
