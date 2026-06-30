# The Views

OpenNapse has **7 views** plus a Settings modal and a (currently gated) Mentor panel. There is no router — `App.tsx` holds an `activeView` state typed by the `ViewId` enum and renders one view at a time:

```ts
type ViewId = 'capture' | 'dashboard' | 'kanban' | 'notes' | 'graph' | 'focus' | 'stats'
```

All views are defined as functions inside `apps/web/src/App.tsx`. The nav rail (left side) is driven by a `views` array of `{ id, label, icon, status }`.

---

## Capture (`CaptureView`)

The default view and the front door of the app. A masonry grid of idea cards.

- Hit `Space` anywhere to open the capture box and dump an idea with zero friction.
- Ideas carry a **temperature** — hot / warm / cool / cold — derived from how recently they were touched (`getIdeaTemperature` in `domain/ideas.ts`). Filter by temperature to find what's still alive.
- Buried ideas move to a **graveyard**; you can resurrect them later.
- Ideas have an `energyLevel` (1–5), an optional `mood`, tags, and a color.

This is where the loop starts: capture cheaply, promote selectively.

## Dashboard (`DashboardView`)

Your projects, organized as folders/projects in a grid or list.

- Shows each project with its `whyNow`, `firstStep`, and `doneLooksLike`.
- Surfaces the ideas linked to each project (`sourceIdeaId`).
- Project status: planning / active / paused / shipped / abandoned.

This is the project-scoped context hub once ideas have graduated.

## Kanban (`KanbanView`)

Plan the work. Five columns: **backlog → todo → in_progress → review → done**.

- Native HTML5 drag-and-drop (`DraggableTaskCard` + `DroppableKanbanColumn`).
- Keyboard movement: focus a card and use `Alt+Arrow` to move it between columns — no mouse required.
- Tasks belong to a project (`projectId`), can optionally link to an idea, and track `completionPct` / `completedAt`.

Open quickly with `⌘2`.

## Notes (`NotesView`)

Local notes linked to ideas or projects.

- Markdown content (up to 50k characters) edited in `NoteEditor`.
- **Voice recordings** via the browser `MediaRecorder` API — up to 10 per note. Real, tested.
- Link a note to an idea (`linkedIdeaId`) and/or a project (`linkedProjectId`).
- New note: `⌘N`.

## Graph (`GraphView`)

A map of your thinking. An SVG node/edge graph showing how ideas, projects, tasks, and notes connect.

- Nodes are entities; edges are the relationships (idea→project, project→task, note links).
- Useful for seeing clusters and orphans at a glance.

## Focus (`FocusView`)

A distraction-free surface for what matters today. Shows your top open tasks so you can do the one thing in front of you.

- Enter with `⌘⇧F` ("Flow mode").

## Stats (`StatsView`)

Momentum tracking.

- **Idea-to-reality ratio** and a **momentum score** (`calculateStats` in `domain/stats.ts`: ideas + projects×3 + tasksDone×2).
- JSON **export / import** of your whole workspace.
- A "load demo data" affordance for trying the app quickly.
- Open with `⌘7`.

---

## Settings (modal, not a view)

`SettingsModal` is a modal, not part of the `ViewId` enum. Sections:

- **Profile** — auth / bootstrap / Supabase status.
- **Appearance** — theme (light / dark).
- **Workspace** — workspace switcher and workspace mode (personal is live; team is preview/disabled).
- **AI providers** — consent toggle, provider/model selection, base URL, and the session-only key gate. See [AI & BYOK](./ai.md).
- **Privacy and security** — including **Clear all local data**.
- **Hosted request preview**, **Audit log**, **Credits and usage**, **Team settings** — these depend on the Supabase path.

## Mentor (gated panel)

`MentorPanel` is a side panel, gated off by default (`SHOW_MENTOR_PANEL = false` in `App.tsx`). When enabled, it's a **fully local** assistant: `generateMentorReply` in `domain/mentor.ts` routes your message by keyword (summary / focus / risks / ideas / projects / notes / tasks) and returns summaries built from your own data. **It does not call a hosted LLM.** Hosted AI is a separate, opt-in path (see [AI & BYOK](./ai.md)).

---

## Command palette

Press `⌘K` / `Ctrl+K` to open `CommandPalette`. Current commands:

| Command | Shortcut |
|---------|----------|
| New Idea | `Space` |
| New Note | `⌘N` |
| Search Everything | `⌘F` |
| Go to Kanban | `⌘2` |
| Enter Flow Mode | `⌘⇧F` |
| Open Stats | `⌘7` |

Navigate with arrows, select with Enter, dismiss with Esc.

## Adding or changing a view

1. Add the id to the `ViewId` union in `App.tsx`.
2. Add an entry to the `views` array (id / label / icon / status) so it shows in the nav rail.
3. Write the view function and render it in the view switch (`{activeView === 'yourview' && <YourView/>}`).
4. If it needs an icon, extend `IconName` and add an inline `<svg>` in `components/Icon.tsx`.

Keep persistence behind the stores/adapter — views never touch storage directly. See [Data Layer](./data-layer.md).
