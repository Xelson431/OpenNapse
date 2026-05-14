// invite-member — create a workspace_invite row with a unique token.
// Caller must be an active owner/admin of the workspace. A companion
// send-invite function handles email delivery once SMTP is configured.

import { createClient } from 'jsr:@supabase/supabase-js@2'

type InviteBody = {
  workspaceId: string
  email: string
  role: 'admin' | 'member' | 'viewer'
}

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function randomToken(length = 40): string {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' })
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const authorization = request.headers.get('Authorization')
  if (!supabaseUrl || !supabaseAnonKey) return json(500, { error: 'Missing Supabase env.' })
  if (!authorization) return json(401, { error: 'Missing Authorization header.' })

  const caller = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authorization } },
  })
  const { data: authData, error: authError } = await caller.auth.getUser()
  if (authError || !authData.user) return json(401, { error: authError?.message ?? 'Unauthorized' })
  const user = authData.user

  let body: InviteBody
  try {
    body = (await request.json()) as InviteBody
  } catch {
    return json(400, { error: 'Invalid JSON body.' })
  }
  if (!body?.workspaceId || !body.email || !body.role) return json(400, { error: 'workspaceId, email, role required.' })
  if (!['admin', 'member', 'viewer'].includes(body.role)) return json(400, { error: 'role must be admin|member|viewer.' })

  const emailNormalized = body.email.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNormalized)) return json(400, { error: 'Invalid email.' })

  // Caller must be admin/owner of workspace.
  const { data: membership } = await caller
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', body.workspaceId)
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle()
  if (!membership || !['owner', 'admin'].includes(membership.role)) {
    return json(403, { error: 'Only workspace owners/admins can invite.' })
  }

  // Rate limit: max 20 pending invites per workspace per 24h.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { count: recentCount } = await caller
    .from('workspace_invites')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', body.workspaceId)
    .gte('created_at', since)
  if ((recentCount ?? 0) >= 20) return json(429, { error: 'Invite rate limit reached for this workspace.' })

  const token = randomToken()
  const { data: invite, error: insertError } = await caller
    .from('workspace_invites')
    .insert({
      workspace_id: body.workspaceId,
      inviter_user_id: user.id,
      email: emailNormalized,
      role: body.role,
      token,
    })
    .select('id, email, role, expires_at, token')
    .single()
  if (insertError || !invite) return json(400, { error: insertError?.message ?? 'Invite failed.' })

  return json(200, {
    ok: true,
    invite: { id: invite.id, email: invite.email, role: invite.role, expiresAt: invite.expires_at },
    // Token is returned once so the caller can trigger send-invite without
    // round-tripping secrets through the client later.
    token: invite.token,
  })
})
