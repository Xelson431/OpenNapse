import '@testing-library/jest-dom/vitest'

// Node 22 exposes an experimental `localStorage` global that resolves to
// undefined unless a file flag is supplied. Tests run in jsdom, so explicitly
// bind the browser implementation instead of inheriting that Node global.
const values = new Map<string, string>()
const testStorage: Storage = {
  get length() { return values.size },
  clear: () => values.clear(),
  getItem: (key) => values.get(key) ?? null,
  key: (index) => [...values.keys()][index] ?? null,
  removeItem: (key) => { values.delete(key) },
  setItem: (key, value) => { values.set(key, String(value)) },
}
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: testStorage })
Object.defineProperty(window, 'localStorage', { configurable: true, value: testStorage })
