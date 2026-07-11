import { createClient } from 'jsr:@supabase/supabase-js@2'

type BootstrapPlan = {
  profile: {
    id: string
    email: string | null
    display_name: string
    created_at: string
    updated_at: string
  }
  workspace: {
    id: string
    type: 'personal'
    name: string
    owner_user_id: string
    created_at: string
    updated_at: string
  }
  membership: {
    workspace_id: string
    user_id: string
    role: 'owner'
    status: 'active'
    created_at: string
  }
}

function displayNameFromEmail(email?: string): string {
  if (!email) return 'Personal workspace'
  const name = email.split('@')[0]?.replace(/[._-]+/g, ' ').trim()
  return name ? `${name}'s workspace` : 'Personal workspace'
}

function createBootstrapPlan(user: { id: string; email?: string }): BootstrapPlan {
  const now = new Date().toISOString()
  const workspaceId = crypto.randomUUID()
  return {
    profile: {
      id: user.id,
      email: user.email ?? null,
      display_name: displayNameFromEmail(user.email),
      created_at: now,
      updated_at: now,
    },
    workspace: {
      id: workspaceId,
      type: 'personal',
      name: 'Personal',
      owner_user_id: user.id,
      created_at: now,
      updated_at: now,
    },
    membership: {
      workspace_id: workspaceId,
      user_id: user.id,
      role: 'owner',
      status: 'active',
      created_at: now,
    },
  }
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const authorization = request.headers.get('Authorization')

  if (!supabaseUrl || !supabaseAnonKey) {
    return new Response(JSON.stringify({ error: 'Missing SUPABASE_URL or SUPABASE_ANON_KEY in function environment.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (!authorization) {
    return new Response(JSON.stringify({ error: 'Missing Authorization header.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const client = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authorization } },
  })

  const { data: authData, error: authError } = await client.auth.getUser()
  if (authError || !authData.user) {
    return new Response(JSON.stringify({ error: authError?.message ?? 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const plan = createBootstrapPlan({ id: authData.user.id, email: authData.user.email })

  const { error: profileError } = await client
    .from('profiles')
    .upsert(plan.profile, { onConflict: 'id' })

  if (profileError) {
    return new Response(JSON.stringify({ error: `Profile bootstrap failed: ${profileError.message}` }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const { data: workspaceRows, error: workspaceError } = await client.rpc('create_workspace', {
    requested_name: plan.workspace.name,
    requested_type: 'personal',
    idempotency_key: plan.workspace.id,
  })
  const workspace = (workspaceRows as Array<{ workspace_id: string; created: boolean }> | null)?.[0]
  if (workspaceError || !workspace) {
    return new Response(JSON.stringify({ error: `Workspace bootstrap failed: ${workspaceError?.message ?? 'No workspace returned.'}` }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({
    ok: true,
    workspaceId: workspace.workspace_id,
    created: workspace.created,
    message: workspace.created ? 'Personal workspace created.' : 'Personal workspace confirmed.',
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})
