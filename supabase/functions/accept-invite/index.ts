// accept-invite — redeem a workspace invite token for the signed-in user.
// The user must be authenticated; the email match is checked against the token.

import { createClient } from 'jsr:@supabase/supabase-js@2'

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
  const admin = createClient(supabaseUrl, serviceRoleKey)
  const { data: authData, error: authError } = await caller.auth.getUser()
  if (authError || !authData.user) return json(401, { error: authError?.message ?? 'Unauthorized' })
  const user = authData.user

  let body: { token?: string }
  try {
    body = (await request.json()) as { token?: string }
  } catch {
    return json(400, { error: 'Invalid JSON body.' })
  }
  const token = body?.token?.trim()
  if (!token) return json(400, { error: 'token required.' })

  const { data: invite } = await admin
    .from('workspace_invites')
    .select('id, workspace_id, email, role, status, expires_at')
    .eq('token', token)
    .maybeSingle()
  if (!invite) return json(404, { error: 'Invite not found.' })
  if (invite.status !== 'pending') return json(409, { error: `Invite is ${invite.status}.` })
  if (new Date(invite.expires_at).getTime() < Date.now()) {
    await admin.from('workspace_invites').update({ status: 'expired' }).eq('id', invite.id)
    return json(410, { error: 'Invite expired.' })
  }

  if (!user.email || invite.email.toLowerCase() !== user.email.toLowerCase()) {
    return json(403, { error: 'Invite email does not match your account.' })
  }

  const { error: memberError } = await admin
    .from('workspace_members')
    .upsert(
      {
        workspace_id: invite.workspace_id,
        user_id: user.id,
        role: invite.role,
        status: 'active',
      },
      { onConflict: 'workspace_id,user_id' },
    )
  if (memberError) return json(400, { error: memberError.message })

  await admin
    .from('workspace_invites')
    .update({ status: 'accepted', accepted_at: new Date().toISOString() })
    .eq('id', invite.id)

  await admin.from('audit_logs').insert({
    actor_user_id: user.id,
    workspace_id: invite.workspace_id,
    action: 'invite.accepted',
    target_type: 'workspace_invite',
    target_id: invite.id,
    metadata: { role: invite.role },
  })

  return json(200, { ok: true, workspaceId: invite.workspace_id, role: invite.role })
})
