import { describe, expect, it, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { assertWriteAllowed, RateLimitError, resetWriteRateLimits } from './rate-limiter'

beforeEach(() => {
  resetWriteRateLimits()
})

describe('assertWriteAllowed', () => {
  it('allows first call for any operation', () => {
    expect(() => assertWriteAllowed('upsertNote')).not.toThrow()
    expect(() => assertWriteAllowed('createIdea')).not.toThrow()
    expect(() => assertWriteAllowed('createProject')).not.toThrow()
  })

  it('throws RateLimitError when upsertNote limit is exceeded (20/min)', () => {
    for (let i = 0; i < 20; i++) {
      assertWriteAllowed('upsertNote')
    }
    expect(() => assertWriteAllowed('upsertNote')).toThrow(RateLimitError)
  })

  it('throws RateLimitError when createIdea limit is exceeded (30/min)', () => {
    for (let i = 0; i < 30; i++) {
      assertWriteAllowed('createIdea')
    }
    expect(() => assertWriteAllowed('createIdea')).toThrow(RateLimitError)
  })

  it('tracks operation quotas independently', () => {
    for (let i = 0; i < 30; i++) {
      assertWriteAllowed('createIdea')
    }
    expect(() => assertWriteAllowed('upsertNote')).not.toThrow()
  })

  it('resets after clear', () => {
    for (let i = 0; i < 30; i++) {
      assertWriteAllowed('createIdea')
    }
    expect(() => assertWriteAllowed('createIdea')).toThrow(RateLimitError)
    resetWriteRateLimits()
    expect(() => assertWriteAllowed('createIdea')).not.toThrow()
  })

  it('RateLimitError exposes operation and retry info', () => {
    for (let i = 0; i < 20; i++) {
      assertWriteAllowed('upsertNote')
    }
    try {
      assertWriteAllowed('upsertNote')
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(RateLimitError)
      const rateErr = err as RateLimitError
      expect(rateErr.operation).toBe('upsertNote')
      expect(rateErr.retryAfterMs).toBeGreaterThan(0)
      expect(rateErr.message).toContain('upsertNote')
    }
  })

  it('importData has a stricter limit (5/10min)', () => {
    for (let i = 0; i < 5; i++) {
      assertWriteAllowed('importData')
    }
    expect(() => assertWriteAllowed('importData')).toThrow(RateLimitError)
  })

  it('fails on the exact Nth+1 call, not before', () => {
    // limit is 20 — calls 1-20 pass, call 21 should throw
    for (let i = 0; i < 20; i++) {
      expect(() => assertWriteAllowed('upsertNote')).not.toThrow()
    }
    expect(() => assertWriteAllowed('upsertNote')).toThrow(RateLimitError)
  })

  it('tolerates micro-bursts: all N calls in the same millisecond', () => {
    for (let i = 0; i < 30; i++) {
      assertWriteAllowed('createIdea')
    }
    expect(() => assertWriteAllowed('createIdea')).toThrow(RateLimitError)
  })

  it('interleaved operations do not interfere', () => {
    for (let i = 0; i < 20; i++) {
      assertWriteAllowed('upsertNote')
      if (i < 5) assertWriteAllowed('importData')
    }
    expect(() => assertWriteAllowed('upsertNote')).toThrow(RateLimitError)
    expect(() => assertWriteAllowed('importData')).toThrow(RateLimitError)
    expect(() => assertWriteAllowed('createIdea')).not.toThrow()
  })

  it('all operation types have independent counters', () => {
    const ops: Array<Parameters<typeof assertWriteAllowed>[0]> = [
      'createIdea', 'buryIdea', 'resurrectIdea', 'moveIdeaToProject',
      'createProject', 'promoteIdea', 'createTask', 'moveTask',
      'updateTask', 'upsertNote', 'deleteNote', 'importData', 'clearAllData',
      'workspaceMutation',
    ]
    for (const op of ops) {
      assertWriteAllowed(op)
    }
    for (const op of ops) {
      expect(() => assertWriteAllowed(op)).not.toThrow()
    }
  })

  it('window expiration allows new calls after time passes', () => {
    vi.useFakeTimers()
    for (let i = 0; i < 20; i++) {
      assertWriteAllowed('upsertNote')
    }
    expect(() => assertWriteAllowed('upsertNote')).toThrow(RateLimitError)

    vi.advanceTimersByTime(60_001)

    expect(() => assertWriteAllowed('upsertNote')).not.toThrow()
    vi.useRealTimers()
  })
})
