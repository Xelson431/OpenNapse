import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseEnv } from '../config/env'

let browserClient: SupabaseClient | null = null

export function getSupabaseBrowserClient(): SupabaseClient | null {
  const env = getSupabaseEnv()
  if (!env.configured) return null

  browserClient ??= createClient(env.url!, env.anonKey!, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  })

  return browserClient
}
