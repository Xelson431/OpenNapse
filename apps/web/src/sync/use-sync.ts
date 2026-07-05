import { getSupabaseEnv } from '../config/env'
import type { AuthStatus } from '../auth/use-auth-status'

export type SyncStatus = 'local-only' | 'synced' | 'syncing' | 'offline'

export function useSyncStatus(authStatus?: AuthStatus) {
  const env = getSupabaseEnv()

  if (env.configured) {
    if (authStatus?.mode === 'signed-in') {
      return {
        status: 'synced' as SyncStatus,
        label: authStatus.email ?? 'Synced',
        description: 'Authenticated and connected to Supabase.',
        syncNow: async () => undefined,
      }
    }

    return {
      status: 'local-only' as SyncStatus,
      label: 'Supabase ready',
      description: `Bound to ${env.projectHost}. Sign in to switch to cloud storage.`,
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
