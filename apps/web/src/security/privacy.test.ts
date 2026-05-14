import { describe, expect, it } from 'vitest'
import { privacyDefaults, securityPrinciples } from './privacy'

describe('privacy defaults', () => {
  it('keeps external systems disabled by default', () => {
    expect(privacyDefaults.telemetry).toBe(false)
    expect(privacyDefaults.cloudSync).toBe(false)
    expect(privacyDefaults.ai).toBe(false)
    expect(privacyDefaults.hostedAI).toBe(false)
  })

  it('documents secure operating principles', () => {
    expect(securityPrinciples).toContain('Local-first by default')
    expect(securityPrinciples).toContain('Cloud sync must use ownership checks and RLS')
  })
})
