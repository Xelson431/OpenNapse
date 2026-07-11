import { describe, expect, it } from 'vitest'
import { useSyncStatus } from './use-sync'

describe('useSyncStatus', () => {
  it('reports migration failure as offline instead of connected', () => {
    const result = useSyncStatus(
      { mode: 'signed-in', label: 'User', description: 'Signed in', userId: 'u1', email: 'user@example.com' },
      { mode: 'ready', description: 'Workspace ready' },
      { mode: 'failed', description: 'Cloud migration failed.' },
    )

    expect(result.status).toBe('offline')
    expect(result.label).toBe('Sync failed')
  })

  it('reports cloud connectivity without claiming sync is available', () => {
    const result = useSyncStatus(
      { mode: 'signed-in', label: 'User', description: 'Signed in', userId: 'u1', email: 'user@example.com' },
      { mode: 'ready', description: 'Workspace ready' },
      { mode: 'ready', description: 'Connected.' },
    )

    expect(result.status).toBe('connected')
    expect(result.label).toBe('Cloud connected')
    expect(result.description).toContain('Cross-device sync is not available yet')
  })
})
