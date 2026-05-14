import { openDB, type IDBPDatabase } from 'idb'

/**
 * Internal storage seam for BrowserLocalAdapter.
 *
 * Content (ideas / projects / tasks / notes / workspaces / sync outbox) is
 * stored whole-collection at a single key. The interface deliberately mirrors
 * the original readJson / writeJson pattern so the adapter migration is a
 * drop-in swap; per-record put/delete is a future optimization.
 *
 * Two implementations are provided:
 *   - IndexedDBBackend: durable, large quota, survives browser eviction
 *     policies better than localStorage. Used in real browsers + Electron.
 *   - LocalStorageBackend: synchronous JSON blob per key. Retained as a
 *     fallback for test environments (jsdom lacks a reliable IDB shim out of
 *     the box) and as the pre-migration source the IDB backend reads from.
 */
export interface StorageBackend {
  read<T>(key: string, fallback: T): Promise<T>
  write<T>(key: string, value: T): Promise<void>
  remove(key: string): Promise<void>
  ready(): Promise<void>
}

const DB_NAME = 'OpenNapse'
const DB_VERSION = 1
const STORE = 'kv'
const MIGRATION_FLAG_KEY = 'OpenNapse:v0:idb-migrated'

const LEGACY_CONTENT_KEYS = [
  'OpenNapse:v0:ideas',
  'OpenNapse:v0:projects',
  'OpenNapse:v0:tasks',
  'OpenNapse:v0:notes',
  'OpenNapse:v0:sync-outbox',
  'OpenNapse:v0:workspaces',
] as const

function hasLocalStorage(): boolean {
  try {
    return typeof localStorage !== 'undefined'
  } catch {
    return false
  }
}

function hasUsableIndexedDB(): boolean {
  if (typeof indexedDB === 'undefined') return false
  // jsdom exposes a partial IDB-like object that throws on open. Real browsers
  // expose a proper IDBFactory with deleteDatabase. Probe for the canonical API.
  try {
    return typeof indexedDB.open === 'function' && typeof indexedDB.deleteDatabase === 'function'
  } catch {
    return false
  }
}

export class LocalStorageBackend implements StorageBackend {
  async ready(): Promise<void> {
    return
  }

  async read<T>(key: string, fallback: T): Promise<T> {
    if (!hasLocalStorage()) return fallback
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    try {
      return JSON.parse(raw) as T
    } catch (error) {
      console.warn(`[OpenNapse] LocalStorageBackend failed to parse "${key}"`, error)
      return fallback
    }
  }

  async write<T>(key: string, value: T): Promise<void> {
    if (!hasLocalStorage()) return
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch (error) {
      console.warn(`[OpenNapse] LocalStorageBackend failed to write "${key}"`, error)
    }
  }

  async remove(key: string): Promise<void> {
    if (!hasLocalStorage()) return
    localStorage.removeItem(key)
  }
}

export class IndexedDBBackend implements StorageBackend {
  private dbPromise: Promise<IDBPDatabase> | null = null
  private migrationPromise: Promise<void> | null = null

  private getDb(): Promise<IDBPDatabase> {
    this.dbPromise ??= openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE)
        }
      },
    })
    return this.dbPromise
  }

  async ready(): Promise<void> {
    this.migrationPromise ??= this.migrateLegacyLocalStorage()
    await this.migrationPromise
  }

  private async migrateLegacyLocalStorage(): Promise<void> {
    if (!hasLocalStorage()) return
    if (localStorage.getItem(MIGRATION_FLAG_KEY) === 'true') return

    const db = await this.getDb()
    const tx = db.transaction(STORE, 'readwrite')
    let migratedAny = false
    for (const key of LEGACY_CONTENT_KEYS) {
      const raw = localStorage.getItem(key)
      if (!raw) continue
      try {
        const parsed = JSON.parse(raw) as unknown
        // Only copy if the IDB side is empty, so we never stomp newer data
        // written from another tab/session that already ran the migration.
        const existing = await tx.store.get(key)
        if (existing === undefined) {
          await tx.store.put(parsed, key)
          migratedAny = true
        }
      } catch (error) {
        console.warn(`[OpenNapse] Skipping migration of "${key}"; localStorage value was unparseable.`, error)
      }
    }
    await tx.done

    // Leave legacy keys in place for one more session so a downgrade still
    // works. Mark migration complete so the import only runs once.
    localStorage.setItem(MIGRATION_FLAG_KEY, 'true')
    if (migratedAny) {
      console.info('[OpenNapse] Migrated local content from localStorage to IndexedDB.')
    }
  }

  async read<T>(key: string, fallback: T): Promise<T> {
    await this.ready()
    const db = await this.getDb()
    const value = await db.get(STORE, key)
    if (value === undefined) return fallback
    return value as T
  }

  async write<T>(key: string, value: T): Promise<void> {
    await this.ready()
    const db = await this.getDb()
    await db.put(STORE, value, key)
  }

  async remove(key: string): Promise<void> {
    await this.ready()
    const db = await this.getDb()
    await db.delete(STORE, key)
  }
}

export function createDefaultStorageBackend(): StorageBackend {
  if (hasUsableIndexedDB()) return new IndexedDBBackend()
  return new LocalStorageBackend()
}
