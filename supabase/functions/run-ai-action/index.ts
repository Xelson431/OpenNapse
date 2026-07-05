// runAiAction — the single gateway for all hosted AI calls.
// Responsibilities: auth + workspace access check, credit enforcement (non-BYOK),
// provider dispatch, Zod-validated response shape, usage event logging.
//
// This is the first server-side code path that may hold BYOK secrets. Keys are
// resolved from the Supabase Vault by vault_secret_id associated with an
// ai_provider_configs row. No plaintext keys in storage, no keys in logs.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const AI_ACTION_COSTS: Record<string, number> = {
  'connection-test': 0,
  'promote-idea-suggestions': 1,
  'summarize-idea': 1,
  'extract-tasks': 1,
  'generate-project-plan': 2,
  'weekly-digest': 2,
  'chat-with-project': 1,
  'bulk-enrich-ideas': 5,
}

type RunAiActionBody = {
  actionType: keyof typeof AI_ACTION_COSTS | string
  workspaceId?: string
  providerConfigId: string
  input?: unknown
  includeNoteBodies?: boolean
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

  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    return json(500, { error: 'runAiAction is missing Supabase env (URL/anon/service-role).' })
  }
  if (!authorization) return json(401, { error: 'Missing Authorization header.' })

  const caller = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authorization } },
  })
  const admin = createClient(supabaseUrl, serviceRoleKey)

  const { data: authData, error: authError } = await caller.auth.getUser()
  if (authError || !authData.user) return json(401, { error: authError?.message ?? 'Unauthorized' })
  const user = authData.user

  let body: RunAiActionBody
  try {
    body = (await request.json()) as RunAiActionBody
  } catch {
    return json(400, { error: 'Invalid JSON body.' })
  }
  if (!body || typeof body !== 'object') return json(400, { error: 'Invalid body.' })
  if (typeof body.actionType !== 'string') return json(400, { error: 'actionType required.' })
  if (typeof body.providerConfigId !== 'string') return json(400, { error: 'providerConfigId required.' })

  // Workspace access — only required when a workspaceId is supplied.
  if (body.workspaceId) {
    const { data: membership, error: memberError } = await caller
      .from('workspace_members')
      .select('id')
      .eq('workspace_id', body.workspaceId)
      .eq('user_id', user.id)
      .eq('status', 'active')
      .maybeSingle()
    if (memberError || !membership) return json(403, { error: 'Not a member of this workspace.' })
  }

  // Provider config (caller must own it or be admin of its workspace).
  const { data: config, error: configError } = await caller
    .from('ai_provider_configs')
    .select('id, scope, user_id, workspace_id, provider_id, base_url, model_id, vault_secret_id')
    .eq('id', body.providerConfigId)
    .maybeSingle()
  if (configError || !config) return json(404, { error: 'Provider config not found.' })

  if (config.scope === 'workspace') {
    if (!body.workspaceId || body.workspaceId !== config.workspace_id) {
      return json(403, { error: 'Workspace-scoped provider config must match the requested workspace.' })
    }
  }

  const cost = AI_ACTION_COSTS[body.actionType] ?? 1
  const isByok = Boolean(config.vault_secret_id)

  // Credit enforcement — only when NOT BYOK (BYOK = free per product decision).
  if (!isByok && cost > 0) {
    const today = new Date().toISOString().slice(0, 10)
    const { data: balance } = await admin
      .from('daily_credit_balances')
      .select('credits_granted, credits_used')
      .eq('user_id', user.id)
      .eq('day', today)
      .maybeSingle()
    const granted = balance?.credits_granted ?? 10
    const used = balance?.credits_used ?? 0
    if (used + cost > granted) {
      await admin.from('ai_usage_events').insert({
        user_id: user.id,
        workspace_id: body.workspaceId ?? null,
        provider_id: config.provider_id,
        provider_config_id: config.id,
        model_id: config.model_id ?? 'unknown',
        action_type: body.actionType,
        credits_charged: 0,
        used_byok: false,
        status: 'blocked',
        error_code: 'credits_exhausted',
      })
      return json(402, { error: 'Daily AI credits exhausted. Try again after UTC midnight, or configure BYOK.' })
    }
  }

  // NOTE: The actual provider HTTP dispatch (OpenAI, Anthropic, Ollama Cloud,
  // OpenRouter, Mistral, DeepSeek, Groq) is intentionally a TODO stub so this
  // function can be deployed and reasoned about without a live key. Returning
  // a typed ok response keeps the shape contract with the frontend gateway.

  // Bookkeeping.
  const today = new Date().toISOString().slice(0, 10)
  if (!isByok && cost > 0) {
    const { data: current } = await admin
      .from('daily_credit_balances')
      .select('credits_granted, credits_used')
      .eq('user_id', user.id)
      .eq('day', today)
      .maybeSingle()
    const granted = current?.credits_granted ?? 10
    const used = (current?.credits_used ?? 0) + cost
    await admin
      .from('daily_credit_balances')
      .upsert({ user_id: user.id, day: today, credits_granted: granted, credits_used: used, updated_at: new Date().toISOString() }, { onConflict: 'user_id,day' })
  }
  await admin.from('ai_usage_events').insert({
    user_id: user.id,
    workspace_id: body.workspaceId ?? null,
    provider_id: config.provider_id,
    provider_config_id: config.id,
    model_id: config.model_id ?? 'unknown',
    action_type: body.actionType,
    credits_charged: isByok ? 0 : cost,
    used_byok: isByok,
    status: 'ok',
  })

  return json(200, {
    ok: true,
    actionType: body.actionType,
    providerId: config.provider_id,
    modelId: config.model_id,
    creditsCharged: isByok ? 0 : cost,
    usedByok: isByok,
    // Placeholder payload — replace with validated provider response once dispatch lands.
    payload: { note: 'runAiAction dispatch stub. Hook up provider HTTP call and Zod-validate response shape here.' },
  })
})
