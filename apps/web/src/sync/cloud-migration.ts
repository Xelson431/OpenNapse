import type { DBAdapter } from '../db/adapter'

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

export async function migrateLocalDataToCloud(localAdapter: DBAdapter, cloudAdapter: DBAdapter): Promise<LocalCloudMigrationCounts> {
  const [localPayload, cloudIdeas, cloudProjects, cloudTasks, cloudNotes] = await Promise.all([
    localAdapter.exportData(),
    cloudAdapter.listIdeas(),
    cloudAdapter.listProjects(),
    cloudAdapter.listTasks(),
    cloudAdapter.listNotes(),
  ])

  const localCounts = countExportPayload(localPayload)
  const cloudEmpty = cloudIdeas.length + cloudProjects.length + cloudTasks.length + cloudNotes.length === 0

  if (cloudEmpty && hasExportedContent(localCounts)) {
    await cloudAdapter.importData(localPayload)
  }

  return localCounts
}
