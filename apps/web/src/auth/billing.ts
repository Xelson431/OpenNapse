import { useEffect, useState } from 'react'
import { getBillingEnv } from '../config/env'
import { getSupabaseBrowserClient } from '../lib/supabase'
import type { AuthStatus } from './use-auth-status'

export type BillingPlan = {
  id: string
  name: string
  priceLabel?: string
  description?: string
  features: string[]
}

export type SubscriptionStatus = {
  planId: string
  planName: string
  status: 'free' | 'active' | 'trialing' | 'past_due' | 'canceled' | 'incomplete' | 'unavailable'
  periodEnd?: string | null
  features: Record<string, unknown>
  plans: BillingPlan[]
}

export type BillingResult<T> = { ok: true; data: T } | { ok: false; error: string }

const unavailableStatus: SubscriptionStatus = {
  planId: 'free',
  planName: 'Free',
  status: 'unavailable',
  periodEnd: null,
  features: {},
  plans: [],
}

function billingUrl(path: string): string {
  const env = getBillingEnv()
  if (!env.configured || !env.url) throw new Error(env.message)
  const base = env.url.endsWith('/') ? env.url : `${env.url}/`
  return new URL(path.replace(/^\//, ''), base).toString()
}

async function authHeaders(): Promise<Record<string, string>> {
  const client = getSupabaseBrowserClient()
  if (!client) throw new Error('Supabase must be configured before billing can be used.')
  const { data } = await client.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Sign in to manage billing.')
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
}

export async function fetchSubscriptionStatus(workspaceId: string): Promise<BillingResult<SubscriptionStatus>> {
  const env = getBillingEnv()
  if (!env.configured) return { ok: true, data: unavailableStatus }
  try {
    const url = new URL(billingUrl('/subscription-status'))
    url.searchParams.set('workspaceId', workspaceId)
    const response = await fetch(url, { headers: await authHeaders() })
    const data = await response.json() as SubscriptionStatus | { error?: string }
    if (!response.ok) return { ok: false, error: 'error' in data && data.error ? data.error : 'Billing status request failed.' }
    return { ok: true, data: data as SubscriptionStatus }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function createCheckoutSession(workspaceId: string, planId: string): Promise<BillingResult<{ url: string }>> {
  try {
    const response = await fetch(billingUrl('/create-checkout'), {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({ workspaceId, planId }),
    })
    const data = await response.json() as { url?: string; error?: string }
    if (!response.ok || !data.url) return { ok: false, error: data.error ?? 'Checkout session failed.' }
    return { ok: true, data: { url: data.url } }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function createBillingPortalSession(workspaceId: string): Promise<BillingResult<{ url: string }>> {
  try {
    const response = await fetch(billingUrl('/billing-portal'), {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({ workspaceId }),
    })
    const data = await response.json() as { url?: string; error?: string }
    if (!response.ok || !data.url) return { ok: false, error: data.error ?? 'Billing portal session failed.' }
    return { ok: true, data: { url: data.url } }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export function useSubscriptionStatus(workspaceId: string, authStatus: AuthStatus) {
  const [status, setStatus] = useState<SubscriptionStatus>(unavailableStatus)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (authStatus.mode !== 'signed-in') return
    let active = true
    void Promise.resolve().then(async () => {
      if (!active) return
      setLoading(true)
      const result = await fetchSubscriptionStatus(workspaceId)
      if (!active) return
      if (result.ok) {
        setStatus(result.data)
        setError('')
      } else {
        setError(result.error)
      }
      setLoading(false)
    })
    return () => { active = false }
  }, [authStatus.mode, workspaceId])

  return { status: authStatus.mode === 'signed-in' ? status : unavailableStatus, error, loading }
}
