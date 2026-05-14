import { describe, expect, it } from 'vitest'
import { getIdeaTemperature } from './ideas'

describe('getIdeaTemperature', () => {
  const now = new Date('2026-05-08T12:00:00.000Z')

  it('marks recent ideas as hot', () => {
    expect(getIdeaTemperature('2026-05-07T12:00:00.000Z', now)).toBe('hot')
  })

  it('marks week-old ideas as warm', () => {
    expect(getIdeaTemperature('2026-05-03T12:00:00.000Z', now)).toBe('warm')
  })

  it('marks two-week ideas as cool', () => {
    expect(getIdeaTemperature('2026-04-28T12:00:00.000Z', now)).toBe('cool')
  })

  it('marks older ideas as cold', () => {
    expect(getIdeaTemperature('2026-04-01T12:00:00.000Z', now)).toBe('cold')
  })
})
