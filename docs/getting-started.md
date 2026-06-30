# Getting Started

This guide takes you from a fresh clone to a running app and your first idea-to-ship loop. No database or account required.

## Prerequisites

- **Node 20+**
- **pnpm 10+** — this is a pnpm workspace. Do not use npm or yarn (only `pnpm-lock.yaml` is committed).

Check your versions:

```bash
node --version   # v20 or higher
pnpm --version   # 10 or higher
```

If you don't have pnpm: `npm install -g pnpm` or see [pnpm.io/installation](https://pnpm.io/installation).

## Clone and install

```bash
git clone https://github.com/Xelson431/OpenNapse.git
cd OpenNapse
pnpm install
```

`pnpm install` installs dependencies for the whole workspace. The only app today is `apps/web`.

## Run the dev server

```bash
pnpm dev
```

Open [http://localhost:5173](http://localhost:5173). That's it — no backend, no accounts. Everything you create is stored in your browser via IndexedDB.

> The root `pnpm dev` is a shortcut for `pnpm --filter @opennapse/web dev`. Both do the same thing.

## Your first loop: capture → promote → plan

OpenNapse is built around one workflow. Here's the whole thing in five minutes.

1. **Capture an idea.** On the Capture view (the default), hit `Space` anywhere to open the capture box, type an idea, and save. Capture is meant to be frictionless — bad ideas are cheap, losing good ones is expensive.
2. **Let it cool or heat up.** Ideas have a "temperature" (hot / warm / cool / cold) based on how recently you touched them. Filter by temperature to find what's alive.
3. **Promote the good ones.** Turn an idea into a real project. Promotion creates a project (with `whyNow`, `firstStep`, `doneLooksLike`) and seeds a first task from `firstStep`.
4. **Plan on Kanban.** Open the Kanban view (`⌘2`). Move tasks across columns (backlog → todo → in progress → review → done) with native drag-and-drop or `Alt+Arrow` keys.
5. **Watch momentum.** The Stats view (`⌘7`) shows your idea-to-reality ratio and a momentum score, so you can tell whether you're shipping or just collecting.

Link notes (text or voice) to any idea or project along the way, and see the whole thing as a connected graph in the Graph view.

See [The Views](./views.md) for a full tour and [keyboard shortcuts](#keyboard-shortcuts) below.

## Keyboard shortcuts

OpenNapse is keyboard-first. The global handlers live in `apps/web/src/App.tsx`.

| Shortcut | Action |
|----------|--------|
| `Space` | Open the capture box (new idea) |
| `⌘K` / `Ctrl+K` | Open the command palette |
| `Esc` | Close the open modal/palette |
| `⌘N` | New note |
| `⌘F` | Search everything |
| `⌘2` | Go to Kanban |
| `⌘⇧F` | Enter Flow (Focus) mode |
| `⌘7` | Open Stats |
| `Alt+Arrow` | Move the focused Kanban task between columns |

The command palette (`⌘K`) is the fastest way to navigate and create. Open it and start typing.

## Useful commands

```bash
pnpm dev          # dev server with HMR
pnpm build        # typecheck + production build → apps/web/dist/
pnpm test:run     # run the test suite once (Vitest)
pnpm test         # Vitest in watch mode
pnpm typecheck    # TypeScript project check
pnpm lint         # ESLint
```

For the desktop build, e2e tests, and the optional Supabase path, see the docs linked from the [docs index](./README.md).

## Where your data lives

By default, everything is in your browser:

- **IndexedDB** is the primary store (via the `idb` library).
- **localStorage** is a fallback (used in environments where IndexedDB isn't available, e.g. some test runners).

To wipe everything and start fresh, open **Settings → Privacy and security → Clear all local data**, or clear site data in your browser's dev tools.

Nothing leaves your machine unless you explicitly turn on a hosted AI provider or wire up Supabase. See [AI & BYOK](./ai.md) and [Supabase Backend](./supabase.md).

## Next steps

- [Project Structure](./project-structure.md) — find your way around the codebase.
- [Data Layer](./data-layer.md) — how domain models, the adapter, and stores fit together.
- [Contributing](../CONTRIBUTING.md) — before you open a PR.
