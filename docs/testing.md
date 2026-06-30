# Testing & Checks

OpenNapse ships with unit tests, e2e tests, linting, and a typechecked build. Run the narrowest useful check while iterating; run the full set before opening a PR.

## The four checks

```bash
pnpm typecheck    # TypeScript project check (no emit)
pnpm lint         # ESLint (flat config)
pnpm test:run     # Vitest, one-shot
pnpm build        # typecheck + production build
```

All four must pass before a PR is merged. See [Contributing](../CONTRIBUTING.md).

## Unit tests (Vitest)

```bash
pnpm test         # watch mode (use while developing)
pnpm test:run     # one-shot (use in CI / before pushing)
```

- Framework: **Vitest** + **Testing Library**.
- Setup file: `apps/web/src/test/setup.ts`.
- Tests live next to the code they cover, as `*.test.ts(x)`.

### What's covered

The domain layer and key seams are well tested — these are pure and fast to test:

| Area | Test files |
|------|-----------|
| Domain models | `domain/ideas.test.ts`, `projects.test.ts`, `stats.test.ts`, `mentor.test.ts`, `ai.test.ts`, `workspaces.test.ts` |
| Adapter | `db/supabase-cloud-adapter.test.ts` |
| AI provider | `ai/provider.test.ts` |
| Auth | `auth/bootstrap.test.ts`, `auth/use-auth-status.test.tsx` |
| Config | `config/env.test.ts` |
| Security | `security/privacy.test.ts` |
| App shell | `App.test.tsx` |

> `App.test.tsx` imports `<App/>` directly, so it never depends on browser-only bits beyond what jsdom provides.

### Writing tests

- Put new tests beside the source: `foo.ts` → `foo.test.ts`.
- Domain logic is pure — test it directly, no mocks needed.
- For store/adapter behavior, the `LocalStorageBackend` fallback makes persistence testable without IndexedDB.
- Add or update tests for any new feature or behavior change. The domain layer is the easiest and highest-value place to add coverage.

## E2E tests (Playwright)

```bash
pnpm --filter @opennapse/web exec playwright test
```

Specs live in `apps/web/e2e/`. You may need to install browsers the first time:

```bash
pnpm --filter @opennapse/web exec playwright install
```

## Typecheck

```bash
pnpm typecheck
```

Strict TypeScript. `pnpm build` runs this too, so a green build implies a green typecheck.

> The Deno Edge Functions under `supabase/functions/` are **not** part of the `apps/web` tsconfig. Your editor may show `Cannot find name 'Deno'` / `Cannot find module 'jsr:...'` for them — that is expected and does not affect `pnpm typecheck` or `pnpm build` for the web app.

## Lint

```bash
pnpm lint
```

ESLint flat config with `typescript-eslint`, `react-hooks`, and `react-refresh`. House rules (see [Contributing](../CONTRIBUTING.md)): no `any` unless commented why, named exports for utilities, Zod at domain boundaries, CSS-first (no Tailwind).

## Recommended pre-PR sequence

```bash
pnpm typecheck && pnpm lint && pnpm test:run && pnpm build
```

If you changed UI behavior meaningfully, also run the Playwright e2e suite and attach screenshots to your PR.
