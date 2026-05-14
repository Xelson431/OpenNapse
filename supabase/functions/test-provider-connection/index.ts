// test-provider-connection — verify that a provider config (BYOK)
// can reach its endpoint. Reads the key from vault for this single call
// and discards it from memory immediately after. Never returns the key.

import { createClient } from 'jsr:@supabase/supabase-js@2'

type TestBody = {
  providerConfigId: string
}

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' })
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const authorization = request.headers.get('Authorization')
  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) return json(500, { error: 'Missing Supabase env.' })
  if (!authorization) return json(401, { error: 'Missing Authorization header.' })

  const caller = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authorization } },
  })
  const { data: authData, error: authError } = await caller.auth.getUser()
  if (authError || !authData.user) return json(401, { error: authError?.message ?? 'Unauthorized' })

  let body: TestBody
  try {
    body = (await request.json()) as TestBody
  } catch {
    return json(400, { error: 'Invalid JSON body.' })
  }
  if (!body?.providerConfigId) return json(400, { error: 'providerConfigId required.' })

  const { data: config, error: configError } = await caller
    .from('ai_provider_configs')
    .select('id, provider_id, base_url, model_id, vault_secret_id')
    .eq('id', body.providerConfigId)
    .maybeSingle()
  if (configError || !config) return json(404, { error: 'Provider config not found.' })
  if (!config.vault_secret_id) return json(400, { error: 'This config has no stored key. Add a key first.' })

  // Resolve vault secret through service-role client. vault.decrypted_secrets
  // is exposed by Supabase Vault; see https://supabase.com/docs/guides/database/vault
  const admin = createClient(supabaseUrl, serviceRoleKey)
  const { data: secretRow, error: secretError } = await admin
    .schema('vault')
    .from('decrypted_secrets')
    .select('decrypted_secret')
    .eq('id', config.vault_secret_id)
    .maybeSingle()
  if (secretError || !secretRow) return json(500, { error: 'Unable to resolve provider secret.' })
  const apiKey = secretRow.decrypted_secret as string

  const providerId = config.provider_id
  const baseUrl = config.base_url ?? null
  const modelId = config.model_id ?? 'test-model'
  try {
    const response = await pingProvider({ providerId, baseUrl, modelId, apiKey })
    return json(200, { ok: true, providerId, status: response.status, message: response.message })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return json(502, { ok: false, error: message })
  }
})

async function pingProvider(input: {
  providerId: string
  baseUrl: string | null
  modelId: string
  apiKey: string
}): Promise<{ status: number; message: string }> {
  const { providerId, baseUrl, modelId, apiKey } = input
  if (providerId === 'anthropic') {
    const base = baseUrl?.replace(/\/+$/, '') ?? 'https://api.anthropic.com'
    const res = await fetch(`${base}/v1/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: modelId, max_tokens: 8, messages: [{ role: 'user', content: 'ping' }] }),
    })
    return { status: res.status, message: res.statusText || (res.ok ? 'ok' : 'upstream error') }
  }

  if (providerId === 'ollama-cloud') {
    const res = await fetch('https://ollama.com/api/chat', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: modelId, messages: [{ role: 'user', content: 'ping' }], stream: false }),
    })
    return { status: res.status, message: res.statusText || (res.ok ? 'ok' : 'upstream error') }
  }

  // openai-compatible default: OpenAI, OpenRouter, Mistral, DeepSeek, Groq,
  // plus any user-specified custom base URL.
  const defaultBases: Record<string, string> = {
    openai: 'https://api.openai.com',
    openrouter: 'https://openrouter.ai/api',
    mistral: 'https://api.mistral.ai',
    deepseek: 'https://api.deepseek.com',
    groq: 'https://api.groq.com/openai',
  }
  const base = (baseUrl ?? defaultBases[providerId] ?? 'https://api.openai.com').replace(/\/+$/, '')
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: modelId, messages: [{ role: 'user', content: 'ping' }], max_tokens: 8, stream: false }),
  })
  return { status: res.status, message: res.statusText || (res.ok ? 'ok' : 'upstream error') }
}
