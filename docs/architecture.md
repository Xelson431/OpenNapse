# OpenNapse Architecture

OpenNapse starts as a secure local-first SPA. The first implementation keeps cloud, self-hosting, and AI behind explicit interfaces and feature flags so the local product can stabilize without rewrites.

## Core rules

- Local reads and writes work without auth or network.
- UI components never write directly to storage.
- Domain data is validated before persistence.
- Deferred systems remain visible as "Coming soon" in the product.
- Cloud sync, self-hosting, and AI are optional capabilities, not dependencies.

## Main seams

- `domain/`: typed entities, validation, business logic.
- `db/`: adapter contracts and browser-local implementation.
- `sync/`: sync state and future outbox engine.
- `ai/`: provider interface and privacy-safe future AI hooks.
- `security/`: privacy and input-handling constants.

## Future hardening

- Replace the starter browser-local adapter with wa-sqlite + OPFS migrations.
- Add Supabase RLS with per-table ownership policies.
- Add self-hosting Docker Compose after cloud schema stabilizes.
- Add local Ollama/embedding AI providers after local workflows are useful.
