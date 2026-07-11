import type { SyncOutboxEntry } from '../db/adapter'
import { getSupabaseBrowserClient } from '../lib/supabase'

export type SyncEntityType = 'ideas' | 'projects' | 'tasks' | 'notes'

export type SyncMutation = {
  mutationId: string
  entityType: SyncEntityType
  logicalId: string
  operation: 'upsert' | 'delete'
  expectedVersion: number
  payload: Record<string, unknown>
}

export type SyncPushRequest = {
  workspaceId: string
  mutations: SyncMutation[]
}

export type SyncMutationResult = {
  mutationId: string
  outcome: 'applied' | 'conflict' | 'rejected'
  logicalId?: string
  recordId?: string
  version?: number
  serverVersion?: number
  error?: string
}

const MAX_MUTATIONS_PER_REQUEST = 100

function isEntityType(value: string): value is SyncEntityType {
  return value === 'ideas' || value === 'projects' || value === 'tasks' || value === 'notes'
}

/** Converts compacted local mutations into the server RPC contract. */
export function buildSyncPushRequest(workspaceId: string, entries: SyncOutboxEntry[]): SyncPushRequest {
  const mutations: SyncMutation[] = []
  for (const entry of entries) {
    if (entry.workspaceId !== workspaceId || !isEntityType(entry.tableName)) continue
    if (mutations.length === MAX_MUTATIONS_PER_REQUEST) break
      if (!entry.payload || typeof entry.payload !== 'object' || Array.isArray(entry.payload)) {
        throw new Error(`Sync mutation ${entry.id} has no record payload.`)
      }
      const payload = entry.payload as Record<string, unknown>
      const logicalId = typeof payload.logicalId === 'string' ? payload.logicalId : entry.recordId
      const version = typeof payload.version === 'number' && Number.isInteger(payload.version) && payload.version > 0 ? payload.version : 1
      mutations.push({
        mutationId: entry.id,
        entityType: entry.tableName,
        logicalId,
        operation: entry.operation === 'delete' ? 'delete' : 'upsert',
        expectedVersion: Math.max(0, version - 1),
        payload,
      })
  }

  return { workspaceId, mutations }
}

export const syncProtocolLimits = { maxMutationsPerRequest: MAX_MUTATIONS_PER_REQUEST }

export async function pushSyncMutations(request: SyncPushRequest): Promise<SyncMutationResult[]> {
  if (request.mutations.length > MAX_MUTATIONS_PER_REQUEST) throw new Error('Sync push exceeds the mutation batch limit.')
  const client = getSupabaseBrowserClient()
  if (!client) throw new Error('Cloud sync requires a configured Supabase client.')
  const { data, error } = await client.rpc('apply_sync_mutations', {
    target_workspace_id: request.workspaceId,
    mutations: request.mutations,
  })
  if (error) throw new Error(`Sync push failed: ${error.message}`)
  if (!Array.isArray(data)) throw new Error('Sync push returned an invalid result.')
  return data.map((row: Record<string, unknown>) => ({
    mutationId: String(row.mutationId ?? ''),
    outcome: row.outcome === 'applied' || row.outcome === 'conflict' ? row.outcome : 'rejected',
    logicalId: typeof row.logicalId === 'string' ? row.logicalId : undefined,
    recordId: typeof row.recordId === 'string' ? row.recordId : undefined,
    version: typeof row.version === 'number' ? row.version : undefined,
    serverVersion: typeof row.serverVersion === 'number' ? row.serverVersion : undefined,
    error: typeof row.error === 'string' ? row.error : undefined,
  }))
}

export type SyncChange = {
  cursor: number
  entityType: SyncEntityType
  logicalId: string
  recordId: string
  operation: 'upsert' | 'delete'
  version: number
  payload: Record<string, unknown> | null
  changedAt: string
}

export type SyncPullPage = {
  changes: SyncChange[]
  cursorFloor: number
  resnapshotRequired: boolean
}

export async function pullSyncPage(workspaceId: string, afterCursor: number): Promise<SyncPullPage> {
  const client = getSupabaseBrowserClient()
  if (!client) throw new Error('Cloud sync requires a configured Supabase client.')
  const { data, error } = await client.rpc('pull_sync_changes', {
    target_workspace_id: workspaceId,
    after_cursor: afterCursor,
    max_changes: syncProtocolLimits.maxMutationsPerRequest,
  })
  if (error) throw new Error(`Sync pull failed: ${error.message}`)
  const rows = (data ?? []) as Array<Record<string, unknown>>
  const cursorFloor = Number(rows[0]?.cursor_floor ?? 0)
  const resnapshotRequired = rows.some((row) => row.resnapshot_required === true)
  const changes: SyncChange[] = rows.filter((row) => row.cursor != null && row.entity_type != null).map((row) => ({
    cursor: Number(row.cursor),
    entityType: row.entity_type as SyncEntityType,
    logicalId: String(row.logical_id),
    recordId: String(row.record_id),
    operation: row.operation === 'delete' ? 'delete' as const : 'upsert' as const,
    version: Number(row.version),
    payload: row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload) ? row.payload as Record<string, unknown> : null,
    changedAt: String(row.changed_at),
  }))
  return { changes, cursorFloor, resnapshotRequired }
}

export async function pullSyncChanges(workspaceId: string, afterCursor: number): Promise<SyncChange[]> {
  return (await pullSyncPage(workspaceId, afterCursor)).changes
}

export type SnapshotRecord = Omit<SyncChange, 'cursor' | 'operation' | 'changedAt'>

export async function getWorkspaceSnapshotPage(workspaceId: string, entityType: SyncEntityType, afterLogicalId?: string): Promise<SnapshotRecord[]> {
  const client = getSupabaseBrowserClient()
  if (!client) throw new Error('Cloud sync requires a configured Supabase client.')
  const { data, error } = await client.rpc('get_workspace_snapshot', {
    target_workspace_id: workspaceId,
    entity: entityType,
    after_logical_id: afterLogicalId ?? null,
    page_size: 200,
  })
  if (error) throw new Error(`Sync snapshot failed: ${error.message}`)
  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    entityType: row.entity_type as SyncEntityType,
    logicalId: String(row.logical_id),
    recordId: String(row.record_id),
    version: Number(row.version),
    payload: row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload) ? row.payload as Record<string, unknown> : null,
  }))
}
