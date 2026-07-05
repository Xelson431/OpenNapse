import { BrowserLocalAdapter } from './browser-local-adapter'
import type { DBAdapter } from './adapter'

let activeAdapter: DBAdapter = new BrowserLocalAdapter()

export function getDb(): DBAdapter {
  return activeAdapter
}

export function setDb(adapter: DBAdapter): void {
  activeAdapter = adapter
}
