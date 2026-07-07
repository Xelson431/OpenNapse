import { describe, expect, it } from 'vitest'
import { ideaSchema } from './ideas'
import { noteSchema } from './notes'
import { projectSchema } from './projects'
import { taskSchema } from './tasks'
import { workspaceRecordSchema } from './workspaces'

const uuid = () => crypto.randomUUID()
const validUtc = '2024-01-15T10:30:00.000Z'
// Zod datetime({ offset: true }) requires colon in offset (e.g. +00:00).
// Supabase raw timestamptz (e.g. +00 without colon) is normalised by
// the cloud adapter's normalizeDate() before Zod sees it.
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

describe('schema datetime offset tolerance', () => {
  describe('ideaSchema', () => {
    it('accepts Z-suffixed datetimes', () => {
      expect(() => ideaSchema.parse(base({ id: uuid(), title: 't', createdAt: validUtc, updatedAt: validUtc, lastTouchedAt: validUtc }))).not.toThrow()
    })

    it('accepts +00 offset (Supabase microsecond timestamptz)', () => {
      expect(() => ideaSchema.parse(base({ id: uuid(), title: 't', createdAt: validOffset, updatedAt: validOffset, lastTouchedAt: validOffset }))).not.toThrow()
    })

    it('accepts positive offset', () => {
      expect(() => ideaSchema.parse(base({ id: uuid(), title: 't', createdAt: validOffsetPlus, updatedAt: validOffsetPlus, lastTouchedAt: validOffsetPlus }))).not.toThrow()
    })

    it('accepts negative offset', () => {
      expect(() => ideaSchema.parse(base({ id: uuid(), title: 't', createdAt: validOffsetMinus, updatedAt: validOffsetMinus, lastTouchedAt: validOffsetMinus }))).not.toThrow()
    })

    it('accepts zoned without fractional seconds', () => {
      expect(() => ideaSchema.parse(base({ id: uuid(), title: 't', createdAt: zoned, updatedAt: zoned, lastTouchedAt: zoned }))).not.toThrow()
    })

    it('accepts null buriedAt', () => {
      expect(() => ideaSchema.parse(base({ id: uuid(), title: 't', createdAt: validUtc, updatedAt: validUtc, lastTouchedAt: validUtc, buriedAt: null }))).not.toThrow()
    })
  })

  describe('noteSchema', () => {
    it('accepts Z-suffixed and offset datetimes', () => {
      expect(() => noteSchema.parse(base({ id: uuid(), title: 't', createdAt: validUtc, updatedAt: validUtc }))).not.toThrow()
      expect(() => noteSchema.parse(base({ id: uuid(), title: 't', createdAt: validOffset, updatedAt: validOffset }))).not.toThrow()
    })
  })

  describe('projectSchema', () => {
    it('accepts Z-suffixed and offset datetimes', () => {
      expect(() => projectSchema.parse(base({ id: uuid(), title: 't', whyNow: 'w', firstStep: 'f', doneLooksLike: 'd', createdAt: validUtc, updatedAt: validUtc }))).not.toThrow()
      expect(() => projectSchema.parse(base({ id: uuid(), title: 't', whyNow: 'w', firstStep: 'f', doneLooksLike: 'd', createdAt: validOffset, updatedAt: validOffset }))).not.toThrow()
    })
  })

  describe('taskSchema', () => {
    it('accepts Z-suffixed and offset datetimes', () => {
      expect(() => taskSchema.parse(base({ id: uuid(), title: 't', projectId: uuid(), createdAt: validUtc, updatedAt: validUtc }))).not.toThrow()
      expect(() => taskSchema.parse(base({ id: uuid(), title: 't', projectId: uuid(), createdAt: validOffset, updatedAt: validOffset }))).not.toThrow()
    })
  })

  describe('workspaceRecordSchema', () => {
    it('accepts Z-suffixed and offset datetimes', () => {
      expect(() => workspaceRecordSchema.parse({ id: 'w1', type: 'personal', name: 'n', ownerUserId: 'u', createdAt: validUtc, updatedAt: validUtc })).not.toThrow()
      expect(() => workspaceRecordSchema.parse({ id: 'w2', type: 'personal', name: 'n', ownerUserId: 'u', createdAt: validOffset, updatedAt: validOffset })).not.toThrow()
    })
  })
})
