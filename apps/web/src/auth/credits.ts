import { getSupabaseBrowserClient } from '../lib/supabase'

export interface DailyCreditBalance {
  day: string
  granted: number
  used: number
  remaining: number
}

export interface UsageEvent {
  id: string
  createdAt: string
  providerId: string
  modelId: string
  actionType: string
  creditsCharged: number
  usedByok: boolean
  status: 'ok' | 'error' | 'blocked'
}

export type CreditsResult<T> = { ok: true; data: T } | { ok: false; error: string }

function cloud() {
  const client = getSupabaseBrowserClient()
  if (!client) throw new Error('Supabase is not configured; credits lookup is unavailable.')
  return client
}

export async function getTodayBalance(): Promise<CreditsResult<DailyCreditBalance>> {
  try {
    const client = cloud()
    const { data: authData } = await client.auth.getUser()
    if (!authData.user) return { ok: false, error: 'Sign in to view credit balance.' }
    const today = new Date().toISOString().slice(0, 10)
    const { data, error } = await client
      .from('daily_credit_balances')
      .select('day, credits_granted, credits_used')
      .eq('user_id', authData.user.id)
      .eq('day', today)
      .maybeSingle()
    if (error) return { ok: false, error: error.message }
    const granted = (data?.credits_granted as number | undefined) ?? 10
    const used = (data?.credits_used as number | undefined) ?? 0
    return {
      ok: true,
      data: { day: today, granted, used, remaining: Math.max(granted - used, 0) },
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function listRecentUsage(limit = 10): Promise<CreditsResult<UsageEvent[]>> {
  try {
    const client = cloud()
    const { data, error } = await client
      .from('ai_usage_events')
      .select('id, created_at, provider_id, model_id, action_type, credits_charged, used_byok, status')
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) return { ok: false, error: error.message }
    const events: UsageEvent[] = ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      id: row.id as string,
      createdAt: row.created_at as string,
      providerId: row.provider_id as string,
      modelId: row.model_id as string,
      actionType: row.action_type as string,
      creditsCharged: (row.credits_charged as number) ?? 0,
      usedByok: Boolean(row.used_byok),
      status: row.status as UsageEvent['status'],
    }))
    return { ok: true, data: events }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
