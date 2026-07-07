import { describe, expect, it, vi } from 'vitest'
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
})
