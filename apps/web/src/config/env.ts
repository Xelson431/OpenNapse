import { z } from 'zod'

type SupabaseEnvInput = {
  VITE_SUPABASE_URL?: string
  VITE_SUPABASE_ANON_KEY?: string
}

type BillingEnvInput = {
  VITE_BILLING_URL?: string
}

export type ResolvedSupabaseEnv = {
  configured: boolean
  mode: 'missing' | 'partial' | 'invalid' | 'configured'
  message: string
  url?: string
  anonKey?: string
  projectHost?: string
}

export type ResolvedBillingEnv = {
  configured: boolean
  mode: 'missing' | 'invalid' | 'configured'
  message: string
  url?: string
  host?: string
}

const supabaseUrlSchema = z.string().url()

export function resolveSupabaseEnv(input: SupabaseEnvInput): ResolvedSupabaseEnv {
  const url = input.VITE_SUPABASE_URL?.trim() ?? ''
  const anonKey = input.VITE_SUPABASE_ANON_KEY?.trim() ?? ''

  if (!url && !anonKey) {
    return {
      configured: false,
      mode: 'missing',
      message: 'Supabase not configured yet. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to enable auth and cloud sync setup.',
    }
  }

  if (!url || !anonKey) {
    return {
      configured: false,
      mode: 'partial',
      message: 'Supabase config is incomplete. Both VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are required.',
      url: url || undefined,
      anonKey: anonKey || undefined,
    }
  }

  const parsedUrl = supabaseUrlSchema.safeParse(url)
  if (!parsedUrl.success) {
    return {
      configured: false,
      mode: 'invalid',
      message: 'Supabase URL must be a valid https URL before auth and sync can be enabled.',
      url,
      anonKey,
    }
  }

  return {
    configured: true,
    mode: 'configured',
    message: 'Supabase is configured. Auth and RLS-gated sync can be built on this project binding next.',
    url,
    anonKey,
    projectHost: new URL(url).host,
  }
}

export function getSupabaseEnv(): ResolvedSupabaseEnv {
  return resolveSupabaseEnv({
    VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
    VITE_SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY,
  })
}

export function resolveBillingEnv(input: BillingEnvInput): ResolvedBillingEnv {
  const url = input.VITE_BILLING_URL?.trim() ?? ''
  if (!url) {
    return {
      configured: false,
      mode: 'missing',
      message: 'Billing wrapper not configured. Add VITE_BILLING_URL to enable hosted plan checks and checkout.',
    }
  }
  const parsedUrl = supabaseUrlSchema.safeParse(url)
  if (!parsedUrl.success) {
    return {
      configured: false,
      mode: 'invalid',
      message: 'Billing URL must be a valid https URL.',
      url,
    }
  }
  return {
    configured: true,
    mode: 'configured',
    message: 'Billing wrapper is configured. Hosted plan checks are available.',
    url,
    host: new URL(url).host,
  }
}

export function getBillingEnv(): ResolvedBillingEnv {
  return resolveBillingEnv({
    VITE_BILLING_URL: import.meta.env.VITE_BILLING_URL,
  })
}
