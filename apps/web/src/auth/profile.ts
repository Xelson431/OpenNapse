import { getSupabaseBrowserClient } from '../lib/supabase'

export type Profile = {
  id: string
  email: string | null
  display_name: string
}

export async function fetchProfile(): Promise<Profile | null> {
  const client = getSupabaseBrowserClient()
  if (!client) return null
  const { data: { user } } = await client.auth.getUser()
  if (!user) return null
  const { data } = await client.from('profiles').select('id, email, display_name').eq('id', user.id).single()
  if (!data) return null
  return data as Profile
}

export async function updateDisplayName(displayName: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const client = getSupabaseBrowserClient()
  if (!client) return { ok: false, error: 'Supabase not configured.' }
  const { data: { user } } = await client.auth.getUser()
  if (!user) return { ok: false, error: 'Not signed in.' }
  const { error } = await client.from('profiles').upsert({
    id: user.id,
    display_name: displayName.trim(),
    email: user.email,
    updated_at: new Date().toISOString(),
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
