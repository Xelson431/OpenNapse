import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { getSupabaseEnv } from '../config/env'
import { getSupabaseBrowserClient } from '../lib/supabase'

export type AuthStatus = {
  mode: 'unavailable' | 'loading' | 'signed-out' | 'signed-in'
  label: string
  description: string
  userId?: string
  email?: string
}

export type AuthActionResult = { ok: true; message: string } | { ok: false; message: string }

function toAuthStatus(session: Session | null): AuthStatus {
  if (!session?.user) {
    return {
      mode: 'signed-out',
      label: 'Signed out',
      description: 'Supabase is configured, but no user session is active yet.',
    }
  }

  return {
    mode: 'signed-in',
    label: session.user.email ?? 'Signed in',
    description: 'Supabase session detected. Authenticated workspace bootstrap is the next step.',
    userId: session.user.id,
    email: session.user.email ?? undefined,
  }
}

export function useAuthStatus(): AuthStatus {
  const client = getSupabaseBrowserClient()
  const env = getSupabaseEnv()
  const [status, setStatus] = useState<AuthStatus>(() => {
    if (!env.configured) {
      return {
        mode: 'unavailable',
        label: 'Supabase unavailable',
        description: env.message,
      }
    }

    return {
      mode: 'loading',
      label: 'Checking session',
      description: `Connecting to ${env.projectHost} to resolve the current auth session.`,
    }
  })

  useEffect(() => {
    if (!client || !env.configured) return

    let active = true

    void client.auth.getSession().then(({ data }) => {
      if (!active) return
      setStatus(toAuthStatus(data.session))
    })

    const { data } = client.auth.onAuthStateChange((_event, session) => {
      if (!active) return
      setStatus(toAuthStatus(session))
    })

    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [client, env.configured, env.projectHost])

  return status
}

export async function requestMagicLink(email: string): Promise<AuthActionResult> {
  const client = getSupabaseBrowserClient()
  if (!client) return { ok: false, message: 'Supabase is not configured yet.' }

  const normalizedEmail = email.trim().toLowerCase()
  if (!normalizedEmail) return { ok: false, message: 'Enter an email address first.' }

  const { error } = await client.auth.signInWithOtp({
    email: normalizedEmail,
    options: {
      emailRedirectTo: window.location.origin,
    },
  })

  if (error) return { ok: false, message: error.message }
  return { ok: true, message: `Magic link sent to ${normalizedEmail}.` }
}

export async function signOutOfSupabase(): Promise<AuthActionResult> {
  const client = getSupabaseBrowserClient()
  if (!client) return { ok: false, message: 'Supabase is not configured yet.' }

  const { error } = await client.auth.signOut()
  if (error) return { ok: false, message: error.message }
  return { ok: true, message: 'Signed out.' }
}
