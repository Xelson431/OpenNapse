# OpenNapse AGENTS

Project-local rules. Keep context compact.

## Style
- Terse. Bullets > prose. No praise. No long summaries unless asked.

## Safety
- Never hardcode secrets or provider keys.
- Never store keys in repo, `VITE_*`, localStorage, sessionStorage, or tests.
- Treat pasted keys as exposed; advise rotation.
- Never kill all Node processes.

## Product
- Local-first idea-to-project workspace.
- Views: Capture, Dashboard, Kanban, Notes, Graph, Focus, Stats.
- Capture: idea dump; promote idea to project/task.
- Dashboard: folders/projects; project-scoped context.
- Kanban: native HTML5 drag/drop + keyboard movement.
- Notes: local notes linked to ideas/projects.
- Sidebar: real project/tag filters.
- Command palette: navigation + creation shortcuts.
- Mentor: local context-aware assistant with sessions; not hosted LLM unless backend path is enabled.
- Settings: theme, auth/bootstrap status, workspace mode, AI provider gates.

## Architecture
- Frontend: React + Vite + TypeScript.
- State: Zustand.
- Persistence: browser local adapter by default.
- DB seam: keep adapter boundaries intact.
- Cloud: Supabase env/client seam + migration/function scaffolds.
- Real cloud CRUD/sync is not enabled yet.

## Implementation Rules
- Default to smallest safe local-first change.
- Touch only needed files; keep diffs small.
- Reuse existing naming/style/patterns.
- Avoid broad refactors unless requested.
- Do not fake hosted AI, cloud sync, or live network tests.
- Inert/staged UI must explain what is missing.

## UI
- Keep current outer padding/frame.
- Preserve responsive behavior.
- Prefer visible feedback over hidden state.
- Do not expose internal roadmap/implementation panels in product UI.

## Backend / Supabase
- RLS first.
- Use Edge Functions for secret-bearing or hosted-AI actions.
- Use caller JWT/user context where possible.
- Personal data private by default.
- Team features stay gated until migrations + RLS + tests exist.
- Content cloud tables need `workspace_id` + `created_by`.

## AI
- Hosted AI requires explicit consent, session/server key path, and exact context preview.
- Current "Test connection gate" is local readiness feedback unless an Edge Function gateway exists.
- Never put hosted provider keys in client code.

## Checks
- tests: `pnpm test -- --run`
- lint: `pnpm lint`
- build: `pnpm build`
- e2e: `pnpm --filter @opennapse/web exec playwright test`
- Run the narrowest useful check first; full run after meaningful app changes.

## Next Likely Work
- Wire frontend bootstrap to Supabase Edge Function.
- Add cloud schema for ideas/projects/tasks/notes.
- Add real cloud adapter only after schema + RLS path is ready.
- Add hosted AI gateway through Edge Function only.
