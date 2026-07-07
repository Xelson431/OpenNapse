import { describe, expect, it } from 'vitest'
import { assertWriteAllowed, RateLimitError, resetWriteRateLimits } from './rate-limiter'

describe('assertWriteAllowed', () => {
  beforeEach(() => {
    resetWriteRateLimits()
  })

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
    // Different operation should still be allowed
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
})
