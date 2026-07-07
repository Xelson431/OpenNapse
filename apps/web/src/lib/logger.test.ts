import { beforeEach, describe, expect, it, vi } from 'vitest'
import { logger, getLogs, clearLogs, subscribeLogs, serializeLogs } from './logger'

beforeEach(() => {
  clearLogs()
})

describe('logger', () => {
  it('records a log entry with correct shape', () => {
    logger.info('test', 'hello world', { foo: 1 })

    const logs = getLogs()
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({
      level: 'info',
      source: 'test',
      message: 'hello world',
      data: { foo: 1 },
    })
    expect(logs[0].id).toMatch(/^log-\d+-\d+$/)
    expect(logs[0].timestamp).toBeDefined()
  })

  it('supports all log levels', () => {
    logger.debug('src', 'debug msg')
    logger.info('src', 'info msg')
    logger.warn('src', 'warn msg')
    logger.error('src', 'error msg')

    const logs = getLogs()
    expect(logs).toHaveLength(4)
    expect(logs[0].level).toBe('error')
    expect(logs[1].level).toBe('warn')
    expect(logs[2].level).toBe('info')
    expect(logs[3].level).toBe('debug')
  })

  it('caps entries at MAX_ENTRIES (500)', () => {
    for (let i = 0; i < 550; i++) {
      logger.info('load', `entry ${i}`)
    }
    expect(getLogs()).toHaveLength(500)
    expect(getLogs()[0].message).toBe('entry 549')
    expect(getLogs()[499].message).toBe('entry 50')
  })

  it('serializes to JSON', () => {
    logger.info('src', 'ser msg', { key: 'val' })
    const json = serializeLogs()
    const parsed = JSON.parse(json)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].message).toBe('ser msg')
  })

  it('notifies subscribers', () => {
    const fn = vi.fn()
    const unsub = subscribeLogs(fn)

    logger.error('err', 'boom')

    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith(expect.objectContaining({ level: 'error', message: 'boom' }))

    unsub()
    logger.info('err', 'silent')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('does not throw when subscriber throws', () => {
    subscribeLogs(() => { throw new Error('nope') })
    expect(() => logger.info('test', 'still works')).not.toThrow()
  })

  it('handles unicode and emoji in messages', () => {
    logger.info('i18n', 'hello 世界 🌍 привет', { emoji: '🚀' })
    const entry = getLogs()[0]
    expect(entry.message).toBe('hello 世界 🌍 привет')
    expect((entry.data as Record<string, unknown>)?.emoji).toBe('🚀')
  })

  it('handles very large data payloads without throwing', () => {
    const big = { arr: new Array(10_000).fill('x').join('') }
    expect(() => logger.warn('big', 'large payload', big)).not.toThrow()
    const logs = getLogs()
    expect(logs).toHaveLength(1)
    expect(typeof (logs[0].data as Record<string, string>)?.arr).toBe('string')
    expect((logs[0].data as Record<string, string>)?.arr.length).toBe(10_000)
  })

  it('handles null, undefined, and Error in data', () => {
    logger.error('edges', 'null data', null)
    logger.info('edges', 'no data')
    logger.warn('edges', 'error obj', new Error('fail'))
    const logs = getLogs()
    // logs are most-recent-first: warn, info, error
    expect(logs[0].level).toBe('warn')
    expect((logs[0].data as Record<string, string>)?.message).toBe('fail')
    expect(logs[1].level).toBe('info')
    expect(logs[1].data).toBeUndefined()
    expect(logs[2].level).toBe('error')
    expect(logs[2].data).toBeNull()
  })

  it('survives rapid subscribe / unsubscribe cycling', () => {
    const fns = new Array(100).fill(null).map(() => vi.fn())
    const unsubs = fns.map((fn) => subscribeLogs(fn))
    unsubs.forEach((u) => u())
    expect(() => logger.info('stress', 'after 100 cycle')).not.toThrow()
  })

  it('re-entrant subscribe inside listener does not break iteration', () => {
    const inner = vi.fn()
    subscribeLogs(() => {
      subscribeLogs(inner)
    })
    logger.info('re', 'entrant')
    expect(inner).toHaveBeenCalled()
  })

  it('concurrent-style logging from multiple sources interleaved', () => {
    const sources = ['ui', 'api', 'db', 'sync', 'auth']
    for (let round = 0; round < 100; round++) {
      for (const src of sources) {
        logger.info(src, `msg-${round}`)
      }
    }
    const logs = getLogs()
    expect(logs).toHaveLength(500)
    const uiLogs = logs.filter((l) => l.source === 'ui')
    expect(uiLogs.length).toBeGreaterThanOrEqual(80)
  })
})
