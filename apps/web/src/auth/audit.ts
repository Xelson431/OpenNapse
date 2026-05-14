import { getSupabaseBrowserClient } from '../lib/supabase'

export interface AuditEntry {
  id: string
  action: string
  targetType: string | null
  targetId: string | null
  actorUserId: string | null
  workspaceId: string | null
  metadata: Record<string, unknown>
  createdAt: string
}

export type AuditResult<T> = { ok: true; data: T } | { ok: false; error: string }

export async function listAuditLog(workspaceId: string | null, limit = 25): Promise<AuditResult<AuditEntry[]>> {
  try {
    const client = getSupabaseBrowserClient()
    if (!client) return { ok: false, error: 'Supabase is not configured.' }
    let query = client
      .from('audit_logs')
      .select('id, actor_user_id, workspace_id, action, target_type, target_id, metadata, created_at')
      .order('created_at', { ascending: false })
      .limit(limit)
    if (workspaceId) query = query.eq('workspace_id', workspaceId)
    const { data, error } = await query
    if (error) return { ok: false, error: error.message }
    const rows = ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      id: row.id as string,
      action: row.action as string,
      targetType: (row.target_type as string | null) ?? null,
      targetId: (row.target_id as string | null) ?? null,
      actorUserId: (row.actor_user_id as string | null) ?? null,
      workspaceId: (row.workspace_id as string | null) ?? null,
      metadata: (row.metadata as Record<string, unknown>) ?? {},
      createdAt: row.created_at as string,
    }))
    return { ok: true, data: rows }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
