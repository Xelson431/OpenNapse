export type LocalCloudMigrationCounts = {
  ideas: number
  projects: number
  tasks: number
  notes: number
}

export function countExportPayload(payload: string): LocalCloudMigrationCounts {
  try {
    const parsed = JSON.parse(payload) as { ideas?: unknown[]; projects?: unknown[]; tasks?: unknown[]; notes?: unknown[] }
    return {
      ideas: Array.isArray(parsed.ideas) ? parsed.ideas.length : 0,
      projects: Array.isArray(parsed.projects) ? parsed.projects.length : 0,
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks.length : 0,
      notes: Array.isArray(parsed.notes) ? parsed.notes.length : 0,
    }
  } catch {
    return { ideas: 0, projects: 0, tasks: 0, notes: 0 }
  }
}

export function hasExportedContent(counts: LocalCloudMigrationCounts): boolean {
  return counts.ideas + counts.projects + counts.tasks + counts.notes > 0
}

export type MergeRecord = {
  id: string
  logicalId?: string
  version: number
  updatedAt: string
}

export type MergePreviewAction = 'create' | 'update' | 'skip' | 'conflict'

export type MergePreviewItem = {
  sourceId: string
  logicalId: string
  targetId?: string
  action: MergePreviewAction
  reason: string
}

function stableId(record: MergeRecord): string {
  return record.logicalId ?? record.id
}

/**
 * Produces a write-free preview. The server repeats this evaluation inside the
 * merge job transaction; this client result is only for explaining the pending
 * operation and must never authorize a commit.
 */
export function buildMergePreview(source: MergeRecord[], target: MergeRecord[]): MergePreviewItem[] {
  const targetByLogicalId = new Map(target.map((record) => [stableId(record), record]))
  return source.map((sourceRecord) => {
    const logicalId = stableId(sourceRecord)
    const targetRecord = targetByLogicalId.get(logicalId)
    if (!targetRecord) return { sourceId: sourceRecord.id, logicalId, action: 'create', reason: 'No cloud record has this logical ID.' }
    if (sourceRecord.version === targetRecord.version && sourceRecord.updatedAt === targetRecord.updatedAt) {
      return { sourceId: sourceRecord.id, logicalId, targetId: targetRecord.id, action: 'skip', reason: 'Both copies are identical.' }
    }
    if (sourceRecord.version > targetRecord.version) {
      return { sourceId: sourceRecord.id, logicalId, targetId: targetRecord.id, action: 'update', reason: 'Local version is newer.' }
    }
    if (sourceRecord.version < targetRecord.version) {
      return { sourceId: sourceRecord.id, logicalId, targetId: targetRecord.id, action: 'skip', reason: 'Cloud version is newer.' }
    }
    return { sourceId: sourceRecord.id, logicalId, targetId: targetRecord.id, action: 'conflict', reason: 'Both copies changed at the same version.' }
  })
}

function cloud() {
  const client = getSupabaseBrowserClient()
  if (!client) throw new Error('Cloud merge requires a configured Supabase client.')
  return client
}

export async function stageCloudMerge(workspaceId: string, exportPayload: string, idempotencyKey = crypto.randomUUID()): Promise<string> {
  let exportedData: unknown
  try { exportedData = JSON.parse(exportPayload) } catch { throw new Error('Backup JSON is invalid.') }
  const { data, error } = await cloud().rpc('stage_merge_export', {
    target_workspace_id: workspaceId,
    idempotency_key: idempotencyKey,
    exported_data: exportedData,
  })
  if (error || typeof data !== 'string') throw new Error(`Merge staging failed: ${error?.message ?? 'No merge job returned.'}`)
  return data
}

export async function resolveCloudMergeItem(itemId: string, resolution: 'source_wins' | 'target_wins' | 'duplicate'): Promise<void> {
  const { error } = await cloud().rpc('resolve_merge_item', { target_item_id: itemId, chosen_resolution: resolution })
  if (error) throw new Error(`Merge resolution failed: ${error.message}`)
}

export async function commitCloudMerge(jobId: string): Promise<Record<string, unknown>> {
  const { data, error } = await cloud().rpc('commit_merge', { target_job_id: jobId })
  if (error || !data || typeof data !== 'object' || Array.isArray(data)) throw new Error(`Merge commit failed: ${error?.message ?? 'Invalid response.'}`)
  return data as Record<string, unknown>
}

export async function rollbackCloudMerge(jobId: string): Promise<Record<string, unknown>> {
  const { data, error } = await cloud().rpc('rollback_merge', { target_job_id: jobId })
  if (error || !data || typeof data !== 'object' || Array.isArray(data)) throw new Error(`Merge rollback failed: ${error?.message ?? 'Invalid response.'}`)
  return data as Record<string, unknown>
}
import { getSupabaseBrowserClient } from '../lib/supabase'
