import { describe, expect, it } from 'vitest'
import { buildMergePreview, countExportPayload, hasExportedContent } from './cloud-migration'

describe('cloud migration helpers', () => {
  it('counts exported records safely', () => {
    expect(countExportPayload(JSON.stringify({ ideas: [1], projects: [1, 2], tasks: [], notes: [1] }))).toEqual({ ideas: 1, projects: 2, tasks: 0, notes: 1 })
    expect(countExportPayload('not-json')).toEqual({ ideas: 0, projects: 0, tasks: 0, notes: 0 })
  })

  it('detects whether exported payload has content', () => {
    expect(hasExportedContent({ ideas: 0, projects: 0, tasks: 0, notes: 0 })).toBe(false)
    expect(hasExportedContent({ ideas: 0, projects: 1, tasks: 0, notes: 0 })).toBe(true)
  })

  it('previews creates, updates, skips, and conflicts without mutating data', () => {
    const preview = buildMergePreview(
      [
        { id: 'new', version: 1, updatedAt: '2026-01-01T00:00:00.000Z' },
        { id: 'local-newer', logicalId: 'shared-newer', version: 3, updatedAt: '2026-01-02T00:00:00.000Z' },
        { id: 'local-older', logicalId: 'shared-older', version: 1, updatedAt: '2026-01-01T00:00:00.000Z' },
        { id: 'same-version', logicalId: 'shared-conflict', version: 2, updatedAt: '2026-01-03T00:00:00.000Z' },
      ],
      [
        { id: 'cloud-newer', logicalId: 'shared-newer', version: 2, updatedAt: '2026-01-01T00:00:00.000Z' },
        { id: 'cloud-older', logicalId: 'shared-older', version: 2, updatedAt: '2026-01-02T00:00:00.000Z' },
        { id: 'cloud-conflict', logicalId: 'shared-conflict', version: 2, updatedAt: '2026-01-02T00:00:00.000Z' },
      ],
    )

    expect(preview.map((item) => item.action)).toEqual(['create', 'update', 'skip', 'conflict'])
  })
})
