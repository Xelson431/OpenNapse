// Centralised actor definitions — single source of truth for who can do what.

export type ActorKind = 'guest' | 'self-hosted' | 'hosted'

export type Capability =
  // Core
  | 'create-idea'
  | 'bury-resurrect-idea'
  | 'promote-idea'
  | 'create-project'
  | 'crud-task'
  | 'crud-note'
  | 'voice-recording'
  | 'graph-view'
  | 'focus-sprint'
  | 'export-import-data'
  | 'search'
  // WYSIWYG
  | 'rich-text-edit'
  | 'wysiwyg-bold'
  | 'wysiwyg-italic'
  | 'wysiwyg-underline'
  | 'wysiwyg-list'
  | 'wysiwyg-link'
  | 'wysiwyg-code'
  // Auth
  | 'sign-in'
  | 'sign-out'
  | 'magic-link'
  | 'cloud-sync'
  | 'auto-migrate'
  // AI
  | 'ai-settings'
  | 'ai-credits'
  | 'ai-test-connection'
  // Billing
  | 'billing-tab'
  | 'billing-portal'
  | 'pricing-modal'
  // Admin
  | 'logs-viewer'
  | 'theme-toggle'
  | 'factory-reset'
  | 'command-palette'

export type Actor = {
  kind: ActorKind
  label: string
  description: string
  capabilities: Set<Capability>
}

function all(...items: Capability[]): Set<Capability> {
  return new Set(items)
}

// ============================================================
// Guest / local-only — no Supabase, no billing.
// ============================================================
const GUEST: Actor = {
  kind: 'guest',
  label: 'Guest',
  description: 'Local-only. No Supabase, no billing. Everything in IndexedDB/localStorage.',
  capabilities: all(
    'create-idea', 'bury-resurrect-idea', 'promote-idea',
    'create-project', 'crud-task', 'crud-note',
    'voice-recording', 'graph-view', 'focus-sprint',
    'export-import-data', 'search',
    'rich-text-edit', 'wysiwyg-bold', 'wysiwyg-italic', 'wysiwyg-underline',
    'wysiwyg-list', 'wysiwyg-link', 'wysiwyg-code',
    'theme-toggle', 'factory-reset', 'command-palette',
    'logs-viewer',
    'ai-settings', 'ai-test-connection',
  ),
}

// ============================================================
// Self-hosted — brings own Supabase, no billing wrapper.
// ============================================================
const SELF_HOSTED: Actor = {
  kind: 'self-hosted',
  label: 'Self-hosted',
  description: 'Own Supabase instance. Sign-in, cloud sync, auto-migration. No billing.',
  capabilities: all(
    ...GUEST.capabilities,
    'sign-in', 'sign-out', 'magic-link',
    'cloud-sync', 'auto-migrate',
    'ai-credits',
  ),
}

// ============================================================
// Hosted — Supabase + billing wrapper (OpenNapse Cloud).
// ============================================================
const HOSTED: Actor = {
  kind: 'hosted',
  label: 'Hosted',
  description: 'Cloud-hosted with billing. All capabilities including subscription management.',
  capabilities: all(
    ...SELF_HOSTED.capabilities,
    'billing-tab', 'billing-portal', 'pricing-modal',
  ),
}

export const ACTORS: Record<ActorKind, Actor> = { guest: GUEST, 'self-hosted': SELF_HOSTED, hosted: HOSTED }

// ============================================================
// Helpers
// ============================================================

export function actorCan(kind: ActorKind, capability: Capability): boolean {
  return ACTORS[kind].capabilities.has(capability)
}

export function actorCannot(kind: ActorKind, capability: Capability): boolean {
  return !ACTORS[kind].capabilities.has(capability)
}

export function guestsOnly(capability: Capability): boolean {
  return actorCan('guest', capability)
    && actorCannot('self-hosted', capability)
    && actorCannot('hosted', capability)
}

/** Capabilities that belong to the billing wrapper layer only. */
export function isBillingGatedCapability(capability: Capability): boolean {
  return capability === 'billing-tab'
    || capability === 'billing-portal'
    || capability === 'pricing-modal'
}

/** Capabilities that require a configured Supabase (auth + cloud sync). */
export function isAuthGatedCapability(capability: Capability): boolean {
  return capability === 'sign-in'
    || capability === 'sign-out'
    || capability === 'magic-link'
    || capability === 'cloud-sync'
    || capability === 'auto-migrate'
}
