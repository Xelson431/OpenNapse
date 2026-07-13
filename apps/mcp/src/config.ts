import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export type McpConfig = {
  supabaseUrl: string
  supabaseAnonKey: string
  accessToken?: string
  refreshToken?: string
  email?: string
  password?: string
}

export function loadConfig(): McpConfig {
  const supabaseUrl = process.env.OPENNAPSE_SUPABASE_URL?.trim()
  const supabaseAnonKey = process.env.OPENNAPSE_SUPABASE_ANON_KEY?.trim()
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'Missing OPENNAPSE_SUPABASE_URL or OPENNAPSE_SUPABASE_ANON_KEY. ' +
        'The OpenNapse MCP server talks to your Supabase cloud workspace.',
    )
  }
  return {
    supabaseUrl,
    supabaseAnonKey,
    accessToken: process.env.OPENNAPSE_ACCESS_TOKEN?.trim() || undefined,
    refreshToken: process.env.OPENNAPSE_REFRESH_TOKEN?.trim() || undefined,
    email: process.env.OPENNAPSE_EMAIL?.trim() || undefined,
    password: process.env.OPENNAPSE_PASSWORD?.trim() || undefined,
  }
}

/**
 * Build a Supabase client authenticated AS the user. All data access then
 * flows through RLS: the agent can only reach the signed-in user's workspaces.
 * No service-role key is ever used, so a leaked MCP config cannot bypass RLS.
 */
export async function createUserClient(config: McpConfig): Promise<{ client: SupabaseClient; userId: string }> {
  const client = createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  if (config.accessToken) {
    const { data, error } = await client.auth.setSession({
      access_token: config.accessToken,
      refresh_token: config.refreshToken ?? '',
    })
    if (error || !data.user) {
      throw new Error(`Could not authenticate with the provided access token: ${error?.message ?? 'no user'}`)
    }
    return { client, userId: data.user.id }
  }

  if (config.email && config.password) {
    const { data, error } = await client.auth.signInWithPassword({
      email: config.email,
      password: config.password,
    })
    if (error || !data.user) {
      throw new Error(`Email/password sign-in failed: ${error?.message ?? 'no user'}`)
    }
    return { client, userId: data.user.id }
  }

  throw new Error(
    'No credentials provided. Set OPENNAPSE_ACCESS_TOKEN (+ optional OPENNAPSE_REFRESH_TOKEN), ' +
      'or OPENNAPSE_EMAIL and OPENNAPSE_PASSWORD.',
  )
}
