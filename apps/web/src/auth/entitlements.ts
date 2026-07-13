import { useEffect, useState } from 'react'
import { getSupabaseBrowserClient } from '../lib/supabase'
import { logger } from '../lib/logger'
import type { AuthStatus } from './use-auth-status'

export type Entitlements = {
  planId: string
  maxWorkspaces: number
  maxSeats: number
  dailyManagedAiCredits: number
  maxPendingInvites: number
  /** Teams need more than the single personal seat/workspace. */
  teamsAllowed: boolean
  loading: boolean
}

const IDLE: Entitlements = {
  planId: 'free',
  maxWorkspaces: 1,
  maxSeats: 1,
  dailyManagedAiCredits: 0,
  maxPendingInvites: 0,
  teamsAllowed: false,
  loading: false,
}

type EntitlementRow = {
  plan_id?: string
  max_workspaces?: number
  max_seats?: number
  daily_managed_ai_credits?: number
  max_pending_invites?: number
}

/**
 * Resolve the caller's entitlements from the server. This is the single source
 * of truth for gating paid capabilities in the UI:
 *   - Self-hosted (public `entitlement_limits`): generous limits → teams work.
 *   - Hosted Pro (private override): 20 workspaces / 100 seats → teams work.
 *   - Hosted Free: 1 workspace / 1 seat → teams gated until upgrade.
 * The server enforces the same limits, so the UI can trust this without being
 * the security boundary.
 */
export function useEntitlements(workspaceId: string | undefined, authStatus: AuthStatus): Entitlements {
  const [entitlements, setEntitlements] = useState<Entitlements>(IDLE)

  useEffect(() => {
    if (authStatus.mode !== 'signed-in' || !workspaceId) {
      setEntitlements(IDLE)
      return
    }
    const client = getSupabaseBrowserClient()
    if (!client) {
      setEntitlements(IDLE)
      return
    }
    let active = true
    setEntitlements((current) => ({ ...current, loading: true }))
    void client
      .rpc('entitlement_limits', { target_workspace_id: workspaceId })
      .then(({ data, error }) => {
        if (!active) return
        const row = (data as EntitlementRow[] | null)?.[0]
        if (error || !row) {
          if (error) logger.warn('entitlements', 'entitlement_limits lookup failed', { error: error.message })
          setEntitlements({ ...IDLE, loading: false })
          return
        }
        const maxSeats = typeof row.max_seats === 'number' ? row.max_seats : 1
        const maxWorkspaces = typeof row.max_workspaces === 'number' ? row.max_workspaces : 1
        setEntitlements({
          planId: row.plan_id ?? 'free',
          maxWorkspaces,
          maxSeats,
          dailyManagedAiCredits: row.daily_managed_ai_credits ?? 0,
          maxPendingInvites: row.max_pending_invites ?? 0,
          teamsAllowed: maxSeats > 1 || maxWorkspaces > 1,
          loading: false,
        })
      })
    return () => {
      active = false
    }
  }, [workspaceId, authStatus.mode])

  return entitlements
}
