import { BrowserLocalAdapter } from './browser-local-adapter'
import type { DBAdapter } from './adapter'

let activeAdapter: DBAdapter = new BrowserLocalAdapter()
let generation = 0
let ready = true

export type DbSnapshot = Readonly<{ adapter: DBAdapter; generation: number }>

/** Prevent new work from using the outgoing adapter until this transition commits. */
export function beginDbTransition(): number {
  generation += 1
  ready = false
  return generation
}

/** Commit only the transition that is still current. */
export function commitDbTransition(adapter: DBAdapter, transition: number): boolean {
  if (generation !== transition) return false
  activeAdapter = adapter
  ready = true
  return true
}

/** Re-open the previously committed adapter when the current transition is abandoned. */
export function cancelDbTransition(transition: number): void {
  if (generation !== transition) return
  generation += 1
  ready = true
}

export function captureDbSnapshot(): DbSnapshot {
  if (!ready) throw new Error('Storage adapter is transitioning. Please try again.')
  return { adapter: activeAdapter, generation }
}

export function isDbSnapshotCurrent(snapshot: DbSnapshot): boolean {
  return ready && generation === snapshot.generation && activeAdapter === snapshot.adapter
}

/** Fail writes that completed against an adapter replaced during the operation. */
export function assertDbSnapshotCurrent(snapshot: DbSnapshot): void {
  if (!isDbSnapshotCurrent(snapshot)) {
    throw new Error('Storage adapter changed while completing the operation. Please try again.')
  }
}

export function getDb(): DBAdapter {
  return captureDbSnapshot().adapter
}

export function setDb(adapter: DBAdapter): void {
  activeAdapter = adapter
  generation += 1
  ready = true
}
