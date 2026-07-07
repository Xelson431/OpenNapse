import { describe, expect, it } from 'vitest'
import { ideaSchema } from './ideas'
import { noteSchema } from './notes'
import { projectSchema } from './projects'
import { taskSchema } from './tasks'
import { workspaceRecordSchema } from './workspaces'

const uuid = () => crypto.randomUUID()
const validUtc = '2024-01-15T10:30:00.000Z'
const validOffset = '2024-01-15T10:30:00.000000+00:00'
const validOffsetPlus = '2024-01-15T10:30:00.000000+05:30'
const validOffsetMinus = '2024-01-15T10:30:00.000000-08:00'
const zoned = '2024-01-15T10:30:00+00:00'

function base(input: Record<string, unknown>) {
  return {
    workspaceId: 'ws-1',
    createdBy: 'user-1',
    clientId: 'test',
    deviceId: 'test',
    version: 1,
    ...input,
  }
}

describe('ideaSchema datetime edge cases', () => {
  const valid = (overrides?: Record<string, unknown>) => ({
    id: uuid(), title: 't',
    createdAt: validUtc, updatedAt: validUtc, lastTouchedAt: validUtc,
    ...overrides,
  })

  it('accepts Z-suffixed datetimes', () => {
    expect(() => ideaSchema.parse(base(valid()))).not.toThrow()
  })

  it('accepts +00 offset (Supabase microsecond timestamptz)', () => {
    expect(() => ideaSchema.parse(base(valid({ createdAt: validOffset, updatedAt: validOffset, lastTouchedAt: validOffset })))).not.toThrow()
  })

  it('accepts positive offset', () => {
    expect(() => ideaSchema.parse(base(valid({ createdAt: validOffsetPlus, updatedAt: validOffsetPlus, lastTouchedAt: validOffsetPlus })))).not.toThrow()
  })

  it('accepts negative offset', () => {
    expect(() => ideaSchema.parse(base(valid({ createdAt: validOffsetMinus, updatedAt: validOffsetMinus, lastTouchedAt: validOffsetMinus })))).not.toThrow()
  })

  it('accepts zoned without fractional seconds', () => {
    expect(() => ideaSchema.parse(base(valid({ createdAt: zoned, updatedAt: zoned, lastTouchedAt: zoned })))).not.toThrow()
  })

  it('accepts null buriedAt', () => {
    expect(() => ideaSchema.parse(base(valid({ buriedAt: null })))).not.toThrow()
  })

  it('leap year: Feb 29 in 2024', () => {
    const d = '2024-02-29T12:00:00.000Z'
    expect(() => ideaSchema.parse(base(valid({ createdAt: d, updatedAt: d, lastTouchedAt: d })))).not.toThrow()
  })

  it('year boundary: Dec 31 + Jan 01 across UTC midnight', () => {
    const d1 = '2023-12-31T23:59:59.999Z'
    const d2 = '2024-01-01T00:00:00.000Z'
    expect(() => ideaSchema.parse(base(valid({ createdAt: d1, updatedAt: d2, lastTouchedAt: d2 })))).not.toThrow()
  })

  it('max fractional: 6 digit microseconds', () => {
    const d = '2024-06-15T14:30:00.123456Z'
    expect(() => ideaSchema.parse(base(valid({ createdAt: d, updatedAt: d, lastTouchedAt: d })))).not.toThrow()
  })

  it('min fractional: 1 digit tenths', () => {
    const d = '2024-06-15T14:30:00.1Z'
    expect(() => ideaSchema.parse(base(valid({ createdAt: d, updatedAt: d, lastTouchedAt: d })))).not.toThrow()
  })

  it('midnight (00:00:00.000) at year start', () => {
    const d = '2024-01-01T00:00:00.000Z'
    expect(() => ideaSchema.parse(base(valid({ createdAt: d, updatedAt: d, lastTouchedAt: d })))).not.toThrow()
  })

  it('far past: year 1970 epoch', () => {
    const d = '1970-01-01T00:00:00.000Z'
    expect(() => ideaSchema.parse(base(valid({ createdAt: d, updatedAt: d, lastTouchedAt: d })))).not.toThrow()
  })

  it('far future: year 9999', () => {
    const d = '9999-12-31T23:59:59.999Z'
    expect(() => ideaSchema.parse(base(valid({ createdAt: d, updatedAt: d, lastTouchedAt: d })))).not.toThrow()
  })

  it('rejects non-ISO strings', () => {
    expect(() => ideaSchema.parse(base(valid({ createdAt: 'not-a-date' })))).toThrow()
  })

  it('rejects invalid month 13', () => {
    expect(() => ideaSchema.parse(base(valid({ createdAt: '2024-13-01T00:00:00.000Z' })))).toThrow()
  })

  it('rejects invalid day 32', () => {
    expect(() => ideaSchema.parse(base(valid({ createdAt: '2024-01-32T00:00:00.000Z' })))).toThrow()
  })

  it('rejects Feb 29 in non-leap year 2023', () => {
    expect(() => ideaSchema.parse(base(valid({ createdAt: '2023-02-29T00:00:00.000Z' })))).toThrow()
  })
})

describe('other schemas', () => {
  it('noteSchema accepts Z and offsets', () => {
    expect(() => noteSchema.parse(base({ id: uuid(), title: 't', createdAt: validUtc, updatedAt: validUtc }))).not.toThrow()
    expect(() => noteSchema.parse(base({ id: uuid(), title: 't', createdAt: validOffset, updatedAt: validOffset }))).not.toThrow()
  })

  it('projectSchema accepts Z and offsets', () => {
    expect(() => projectSchema.parse(base({ id: uuid(), title: 't', whyNow: 'w', firstStep: 'f', doneLooksLike: 'd', createdAt: validUtc, updatedAt: validUtc }))).not.toThrow()
    expect(() => projectSchema.parse(base({ id: uuid(), title: 't', whyNow: 'w', firstStep: 'f', doneLooksLike: 'd', createdAt: validOffset, updatedAt: validOffset }))).not.toThrow()
  })

  it('taskSchema accepts Z and offsets', () => {
    expect(() => taskSchema.parse(base({ id: uuid(), title: 't', projectId: uuid(), createdAt: validUtc, updatedAt: validUtc }))).not.toThrow()
    expect(() => taskSchema.parse(base({ id: uuid(), title: 't', projectId: uuid(), createdAt: validOffset, updatedAt: validOffset }))).not.toThrow()
  })

  it('workspaceRecordSchema accepts Z and offsets', () => {
    expect(() => workspaceRecordSchema.parse({ id: 'w1', type: 'personal', name: 'n', ownerUserId: 'u', createdAt: validUtc, updatedAt: validUtc })).not.toThrow()
    expect(() => workspaceRecordSchema.parse({ id: 'w2', type: 'personal', name: 'n', ownerUserId: 'u', createdAt: validOffset, updatedAt: validOffset })).not.toThrow()
  })
})
