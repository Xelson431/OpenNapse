import { createNoteDraft, type Note } from '../domain/notes'
import type { DraftContext } from '../domain/ideas'

const MAX_ENTRIES = 500

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export type LogEntry = {
  id: string
  timestamp: string
  level: LogLevel
  source: string
  message: string
  data?: unknown
}

type Listener = (entry: LogEntry) => void

let entries: LogEntry[] = []
let listeners: Listener[] = []

let counter = 0

export function log(level: LogLevel, source: string, message: string, data?: unknown): void {
  const entry: LogEntry = {
    id: `log-${Date.now()}-${++counter}`,
    timestamp: new Date().toISOString(),
    level,
    source,
    message,
    data,
  }
  entries = [entry, ...entries].slice(0, MAX_ENTRIES)
  for (const listener of listeners) {
    try { listener(entry) } catch { /* noop */ }
  }
}

export const logger = {
  debug: (source: string, message: string, data?: unknown) => log('debug', source, message, data),
  info: (source: string, message: string, data?: unknown) => log('info', source, message, data),
  warn: (source: string, message: string, data?: unknown) => log('warn', source, message, data),
  error: (source: string, message: string, data?: unknown) => log('error', source, message, data),
}

export function getLogs(): LogEntry[] {
  return entries
}

export function clearLogs(): void {
  entries = []
}

export function subscribeLogs(listener: Listener): () => void {
  listeners.push(listener)
  return () => {
    listeners = listeners.filter((l) => l !== listener)
  }
}

export function serializeLogs(): string {
  return JSON.stringify(entries, null, 2)
}
