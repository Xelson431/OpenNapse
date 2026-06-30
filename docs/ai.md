# AI & BYOK

AI in OpenNapse is **off by default** and **bring-your-own-key (BYOK)**. Nothing is sent to any provider unless you explicitly opt in, choose a provider, supply a key, and accept a preview of exactly what will be sent.

There are two distinct AI paths — don't confuse them:

1. **Local rules / Mentor** — fully local, no network, always available. See `domain/ai.ts` and `domain/mentor.ts`.
2. **Hosted providers (BYOK)** — opt-in, gated, can run client-side with a session key or server-side through a Supabase Edge Function.

## Providers (`apps/web/src/ai/provider.ts`)

The `AIProviderId` registry lists 8 providers — 1 local plus 7 hosted:

| Provider | Type |
|----------|------|
| `local-rules` | Local, no network |
| `ollama-cloud` | Hosted |
| `openai` | Hosted |
| `anthropic` | Hosted |
| `openrouter` | Hosted |
| `mistral` | Hosted |
| `deepseek` | Hosted |
| `groq` | Hosted |

BYOK means: **no markup, no middleman.** You pay your provider directly, and there's no service charging on top.

## How keys stay safe

This is the most important property to understand and preserve. Keys for hosted providers are **session-only** — they live in memory for the session and are never persisted.

Enforced in code (`provider.ts`):

- `aiSettingsSchema` is `.strict()` and **has no key field** — settings that get persisted literally cannot carry a secret.
- `loadAISettings()` rejects any secret-shaped value via a `SECRET_FIELD_PATTERN`. If something key-shaped sneaks into stored settings, it's stripped/rejected on load.
- `AIRequestPreview` masks auth headers as `••••` and hashes the payload. You see what's going out without the secret being logged.
- `canRunHostedAI()` is the gate: it requires **consent + a session key + an accepted exact-payload hash**. Miss any one and hosted AI won't run.

What this means concretely:

- ❌ Keys are **never** written to `localStorage`, `sessionStorage`, or any `VITE_*` env var.
- ❌ Keys are **never** baked into the production bundle.
- ✅ Client-side hosted calls use a session-only key held in memory.
- ✅ Server-side (Supabase path), keys live only in **Supabase Vault**, referenced by a `vault_secret_id` — the plaintext key never returns to the client.

> Project rule: treat any pasted key as exposed and advise rotation. Never commit keys anywhere.

## Costs and credits (`apps/web/src/ai/action-costs.ts`)

For the hosted, server-gated path:

- `DAILY_FREE_AI_CREDITS = 10` free credits per day.
- `AI_ACTION_COSTS` defines per-action cost; `getAIActionCost()` resolves it.
- Using your **own** key (BYOK) skips credit charges entirely.

## Consent and preview flow

The opt-in path, surfaced in **Settings → AI providers**:

1. Toggle AI consent on (off by default).
2. Pick a provider and model; optionally set a base URL (e.g. for self-hosted Ollama).
3. Provide a session key (held in memory only).
4. Review the **request preview** — provider, masked headers, and a hash of the exact payload that will be sent.
5. Accept the preview. Only now does `canRunHostedAI()` return true.

## Server-side gateway (Supabase path)

When Supabase is configured, hosted AI can run server-side instead of from the browser:

- **`supabase/functions/run-ai-action`** — the sole hosted-AI gateway. It authenticates the caller, checks workspace membership, enforces credits, resolves the provider key from Vault, makes the call, and logs usage to `ai_usage_events`.
- **`supabase/functions/test-provider-connection`** — a BYOK reachability check. Reads the Vault key for a single test call and **never returns it** to the client.

Provider configs are stored in `ai_provider_configs` with only a `vault_secret_id` — no plaintext key in the table. See [Supabase Backend](./supabase.md).

## Local AI (no network)

- `domain/ai.ts` — `generateLocalAISuggestions()` (rule-based) and `enhanceIdeaTitle()` (pure string transforms). No network.
- `domain/mentor.ts` — `generateMentorReply()` routes by keyword and summarizes your own data. No LLM. (The Mentor panel itself is gated off by default; see [The Views](./views.md).)

These always work, with zero configuration and zero data leaving the device.

## Adding a provider

1. Add the id to `AIProviderId` and an entry to `AI_PROVIDERS` in `provider.ts`.
2. Wire its request shape into the preview builder (`buildProviderPreview`) so masking/hashing covers it.
3. If it needs server-side support, extend `run-ai-action`.
4. **Never** add a key field to `aiSettingsSchema`. Keys stay session-only or in Vault.

## Rules

- Hosted AI requires explicit consent, a session/server key path, and an exact context preview.
- Validate every AI response with Zod before showing or saving it (AI output is untrusted).
- Prefer local providers (Ollama / rules) as the privacy-preserving default.
- Never put hosted provider keys in client code or the bundle.

See [Security](./security.md) and [External Providers](./external-providers.md) for the full prerequisites.
