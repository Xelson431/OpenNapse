# Data Layer

This is the heart of OpenNapse. Three layers, cleanly separated:

```
domain/   →   stores/   →   db/ (DBAdapter)   →   storage backend
(schemas)     (Zustand)     (the contract)        (IndexedDB / Supabase)
```

Components read from stores. Stores call the adapter. The adapter persists. Nothing skips a layer — components never touch storage directly.

## Domain models (`apps/web/src/domain/`)

Domain modules are **pure**: Zod schemas plus draft-factory functions and business logic. No storage, no network. This makes them trivial to unit test.

### Entities and relationships

```
Idea ──promote──▶ Project ──────▶ Task
  │                  ▲              ▲
  │                  │              │
  └── linked by ─── Note ──────────┘
```

| Entity | File | Key fields | Links |
|--------|------|-----------|-------|
| **Idea** | `ideas.ts` | `title` (≤180), `body` (≤10k), `status` (raw/active/project/done/buried), `tags`, `color`, `energyLevel` (1–5), `mood` | `projectId` → Project |
| **Project** | `projects.ts` | `whyNow`, `firstStep`, `doneLooksLike`, `status` (planning/active/paused/shipped/abandoned) | `sourceIdeaId` → Idea |
| **Task** | `tasks.ts` | `column` (backlog/todo/in_progress/review/done), `priority`, `sortOrder`, `scheduledDate`, `dueDate`, `completionPct`, `completedAt` | `projectId` → Project (required), `ideaId` → Idea (optional) |
| **Note** | `notes.ts` | `content` (≤50k), `voiceRecordings` (≤10, each dataUrl ≤10MB), `tags` | `linkedIdeaId`, `linkedProjectId` |
| **Workspace** | `workspaces.ts` | record + `workspaceModes` (personal live, team-preview disabled) | — |

Every content record also carries `workspaceId` + `createdBy` (for scoping and, later, RLS), plus `version`, `clientId`/`deviceId`, and an `isDeleted` soft-delete flag.

### Key functions

- `createIdeaDraft()`, `createProjectDraft()`, `createTaskDraft()`, `createNoteDraft()` — build valid new records (all share a `DraftContext`).
- `getIdeaTemperature()` — hot/warm/cool/cold from `lastTouchedAt` age.
- `createProjectFromIdea()` — the promotion transform (sets `sourceIdeaId`).
- `createFirstStepTask(project)` — seeds a task from the project's `firstStep`.
- `calculateStats()` (`stats.ts`) — momentum score = ideas + projects×3 + tasksDone×2.

## Stores (`apps/web/src/stores/`)

Three Zustand stores. Each imports the `db` singleton from `db/browser-local-adapter` and is the bridge between views and persistence.

| Store | Owns | Notable actions |
|-------|------|-----------------|
| `use-ideas-store.ts` | ideas list + `isLoaded` | load, create, bury, resurrect, move-to-project, clear |
| `use-workspace-store.ts` | projects, tasks, notes | load, createProject, **promoteIdea**, createTask, moveTask, upsertNote, export/import, clear |
| `use-workspaces-store.ts` | workspace records + `activeWorkspaceId` | switch workspace (calls `db.setActiveWorkspaceId`), persisted to `localStorage` key `OpenNapse:v0:active-workspace-id` |

**Hydration:** `App.tsx` runs a `useEffect` on mount that calls `loadWorkspaces`, `loadIdeas`, `loadWorkspace`. It re-runs whenever `activeWorkspaceId` changes, so switching workspaces reloads scoped data.

## The adapter seam (`apps/web/src/db/`)

This is the most important boundary in the codebase. `adapter.ts` defines the `DBAdapter` interface — the single contract for all persistence:

```
setActiveWorkspaceId, listWorkspaces, createWorkspace, renameWorkspace, deleteWorkspace,
listIdeas, createIdea, buryIdea, resurrectIdea, moveIdeaToProject,
listProjects, createProject,
listTasks, createTask, moveTask, promoteIdea,
listNotes, upsertNote,
exportData, importData, listOutbox
```

Two implementations satisfy this contract:

### `BrowserLocalAdapter` (the live one)

- Exported as the `db` singleton. **This is the only adapter wired into the stores.**
- Persists whole collections as JSON through a `StorageBackend` seam.
- **Validates every record with Zod on read** — corrupt or tampered data is rejected, not trusted.
- Writes a **sync outbox** (`enqueue`) on every mutation, recording `{ tableName, recordId, operation, payload, retryCount, lastError }`. This is the seam a future sync engine will drain. Today nothing drains it.
- `deleteWorkspace` cascades to its content.

### `StorageBackend` (`storage-backend.ts`)

The adapter doesn't talk to the browser directly — it goes through a backend seam:

- `IndexedDBBackend` — primary, via the `idb` library. Includes a one-time migration of legacy `localStorage` data.
- `LocalStorageBackend` — fallback (e.g. test environments without IndexedDB).
- `createDefaultStorageBackend()` — picks IndexedDB if usable, else localStorage.

### `SupabaseCloudAdapter` (written, gated)

- Fully implemented: snake_case ⇄ camelCase row mappers, RLS-shaped queries, `upsert` for notes.
- **Gated**: every method calls `requireClient()`, which throws `CloudAdapterDisabledError` when Supabase env isn't configured, plus `NotSignedIn` / `MissingWorkspace` guards.
- **Never selected at runtime today** — the stores import the local `db` directly; there is no runtime adapter switch yet. Wiring this in is future work (see the README Status note and [Supabase Backend](./supabase.md)).

## Sync status

`apps/web/src/sync/use-sync.ts` reports where your data lives:

- Returns `status: 'coming-soon'` when Supabase env **is** configured (cloud is staged but not active).
- Returns `status: 'local-only'` when it is not.
- `syncNow` is currently a no-op. **No cross-device sync runs.** The Settings UI surfaces this so you always know where your data is.

> Per project rules: do not claim working cloud sync until `use-sync.ts` stops returning `coming-soon`.

## Data flow examples

**Capturing an idea:**
```
CaptureView → useIdeasStore.create() → db.createIdea() → Zod validate → IndexedDB write + outbox enqueue
```

**Promoting an idea to a project:**
```
Promotion modal → useWorkspaceStore.promoteIdea()
  → db.promoteIdea() (idea status → project, create Project via createProjectFromIdea,
                       create first Task via createFirstStepTask)
  → persist all three + outbox entries
```

## Rules for contributors

- Add new persisted data by extending the **domain schema first**, then the `DBAdapter` interface, then **both** adapter implementations.
- Never call `localStorage` or Supabase from a component or view — always go through a store → adapter.
- Keep `workspaceId` + `createdBy` on every content record.
- Treat imported JSON and AI output as untrusted: validate with Zod before persisting.

See [Architecture](./architecture.md) for the higher-level seams and [Security](./security.md) for the guarantees these boundaries protect.
