import { getSupabaseEnv } from '../config/env'
import type { AuthStatus } from '../auth/use-auth-status'

export type SyncStatus = 'local-only' | 'synced' | 'syncing' | 'offline'

export function useSyncStatus(authStatus?: AuthStatus) {
  const env = getSupabaseEnv()

  if (authStatus?.mode === 'signed-in') {
    return {
      status: 'synced' as SyncStatus,
      label: 'Synced',
      description: 'Authenticated and connected to Supabase.',
      syncNow: async () => undefined,
    }
  }

  if (env.configured) {
    return {
      status: 'local-only' as SyncStatus,
      label: 'Sign in to sync',
      description: `Signed out. Cloud data is synced when you sign in.`,
      syncNow: async () => undefined,
    }
  }

  return {
    status: 'local-only' as SyncStatus,
    label: 'Local only',
    description: env.message,
    syncNow: async () => undefined,
  }
}
