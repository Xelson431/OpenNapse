import { getSupabaseEnv } from '../config/env'
import type { AuthStatus } from '../auth/use-auth-status'

export type SyncStatus = 'local-only' | 'offline' | 'syncing' | 'synced' | 'conflict' | 'coming-soon'

export function useSyncStatus(authStatus?: AuthStatus) {
  const env = getSupabaseEnv()

  if (env.configured) {
    return {
      status: 'coming-soon' as SyncStatus,
      label: authStatus?.mode === 'signed-in' ? 'Cloud staged' : 'Supabase ready',
      description: authStatus?.mode === 'signed-in'
        ? `Signed in as ${authStatus.email ?? 'a Supabase user'}. Workspace bootstrap and RLS-protected sync are still not enabled.`
        : `Bound to ${env.projectHost}. Sign-in, workspace scoping, and RLS-protected sync are still not enabled.`,
      syncNow: async () => undefined,
    }
  }

  if (env.mode !== 'missing') {
    return {
      status: 'local-only' as SyncStatus,
      label: 'Config incomplete',
      description: env.message,
      syncNow: async () => undefined,
    }
  }

  return {
    status: 'local-only' as SyncStatus,
    label: 'Local only',
    description: `${env.message} Cloud sync remains opt-in, RLS-protected, and recoverable.`,
    syncNow: async () => undefined,
  }
}
