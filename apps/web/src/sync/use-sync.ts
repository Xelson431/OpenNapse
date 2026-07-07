import { getSupabaseEnv } from '../config/env'
import type { AuthStatus } from '../auth/use-auth-status'

export type SyncStatus = 'local-only' | 'synced' | 'syncing' | 'offline'

export type CloudConnectionStatus = {
  mode: 'idle' | 'connecting' | 'ready' | 'failed'
  description?: string
}

export function useSyncStatus(
  authStatus?: AuthStatus,
  workspaceBootstrap?: { mode: string; description?: string },
  cloudConnection?: CloudConnectionStatus,
) {
  const env = getSupabaseEnv()

  if (authStatus?.mode === 'signed-in') {
    if (workspaceBootstrap?.mode === 'failed') {
      return {
        status: 'offline' as SyncStatus,
        label: 'Bootstrap failed',
        description: workspaceBootstrap.description ?? 'Workspace setup failed.',
        syncNow: async () => undefined,
      }
    }
    if (workspaceBootstrap?.mode === 'bootstrapping' || workspaceBootstrap?.mode === 'idle') {
      return {
        status: 'syncing' as SyncStatus,
        label: 'Connecting…',
        description: workspaceBootstrap.description ?? 'Setting up workspace…',
        syncNow: async () => undefined,
      }
    }
    if (cloudConnection?.mode === 'failed') {
      return {
        status: 'offline' as SyncStatus,
        label: 'Sync failed',
        description: cloudConnection.description ?? 'Cloud migration or adapter setup failed.',
        syncNow: async () => undefined,
      }
    }
    if (cloudConnection?.mode === 'connecting' || cloudConnection?.mode === 'idle' || !cloudConnection) {
      return {
        status: 'syncing' as SyncStatus,
        label: 'Connecting…',
        description: cloudConnection?.description ?? workspaceBootstrap?.description ?? 'Connecting cloud workspace…',
        syncNow: async () => undefined,
      }
    }
    return {
      status: 'synced' as SyncStatus,
      label: 'Synced',
      description: cloudConnection.description ?? workspaceBootstrap?.description ?? 'Connected.',
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
