import { describe, expect, it } from 'vitest'
import { useSyncStatus } from './use-sync'

describe('useSyncStatus', () => {
  it('reports migration failure as offline instead of synced', () => {
    const result = useSyncStatus(
      { mode: 'signed-in', label: 'User', description: 'Signed in', userId: 'u1', email: 'user@example.com' },
      { mode: 'ready', description: 'Workspace ready' },
      { mode: 'failed', description: 'Cloud migration failed.' },
    )

    expect(result.status).toBe('offline')
    expect(result.label).toBe('Sync failed')
  })

  it('reports synced only when cloud connection is ready', () => {
    const result = useSyncStatus(
      { mode: 'signed-in', label: 'User', description: 'Signed in', userId: 'u1', email: 'user@example.com' },
      { mode: 'ready', description: 'Workspace ready' },
      { mode: 'ready', description: 'Connected.' },
    )

    expect(result.status).toBe('synced')
    expect(result.label).toBe('Synced')
  })
})
