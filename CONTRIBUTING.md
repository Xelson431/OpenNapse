# Contributing to OpenNapse

Thanks for your interest in contributing! This document covers the process for submitting changes.

## Getting Started

```bash
git clone https://github.com/Xelson431/OpenNapse.git
cd OpenNapse
pnpm install
pnpm dev
```

## Development Workflow

1. **Fork** the repo and create a branch from `main`.
2. **Make your changes** — keep diffs small and focused.
3. **Run checks** before pushing:
   ```bash
   pnpm typecheck
   pnpm lint
   pnpm test:run
   pnpm build
   ```
4. **Open a Pull Request** against `main`.

## Code Style

- TypeScript strict mode.
- ESLint flat config with `typescript-eslint` + `react-hooks` + `react-refresh`.
- No `any` unless absolutely necessary (and commented why).
- Prefer named exports for utilities; default export for page-level components.
- Zod schemas for all domain boundaries.
- CSS-first styling (no Tailwind in this project); use existing CSS custom properties.

## Architecture Rules

- **Local-first** — default to the smallest safe local change.
- **Adapter boundaries** — all persistence goes through `DBAdapter`. Never call `localStorage` or Supabase directly from components.
- **No secrets in client code** — never hardcode API keys, never store them in `VITE_*` env vars, never persist them to browser storage.
- **Workspace-scoped** — every content record must carry `workspaceId` + `createdBy`.

## Commit Messages

Use clear, imperative-mood messages:

```
fix: prevent sidebar from staying open on mobile after selection
feat: add DeepSeek provider to AI registry
docs: update self-hosting guide with Docker instructions
```

## Testing

- Unit tests: Vitest + Testing Library. Run with `pnpm test:run`.
- E2E tests: Playwright. Run with `pnpm --filter @opennapse/web exec playwright test`.
- Add tests for new features. Update tests when changing behavior.

## Pull Request Guidelines

- One concern per PR.
- Include a brief description of what changed and why.
- Link related issues if applicable.
- All checks must pass (typecheck, lint, tests, build).
- Screenshots for UI changes are appreciated.

## Reporting Bugs

Use the [bug report template](.github/ISSUE_TEMPLATE/bug_report.md) when filing issues.

## Suggesting Features

Use the [feature request template](.github/ISSUE_TEMPLATE/feature_request.md).

## Code of Conduct

This project follows the [Contributor Covenant](./CODE_OF_CONDUCT.md). Be kind.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
