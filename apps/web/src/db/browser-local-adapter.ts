import { logger } from '../lib/logger'
import type { DBAdapter, SyncOutboxEntry } from './adapter'
import { createIdeaDraft, ideaSchema, type CreateIdeaInput, type DraftContext, type Idea } from '../domain/ideas'
import { createNoteDraft, noteSchema, type Note, type UpsertNoteInput } from '../domain/notes'
import { createProjectDraft, createProjectFromIdea, projectSchema, type CreateProjectInput, type Project, type PromoteIdeaInput } from '../domain/projects'
import { createFirstStepTask, createTaskDraft, taskSchema, type CreateTaskInput, type Task, type TaskColumn, type UpdateTaskInput } from '../domain/tasks'
import {
  LOCAL_PERSONAL_WORKSPACE_ID,
  createDefaultPersonalWorkspaceRecord,
  createWorkspaceRecord,
  workspaceRecordSchema,
  type CreateWorkspaceInput,
  type WorkspaceRecord,
} from '../domain/workspaces'
import { createDefaultStorageBackend, type StorageBackend } from './storage-backend'
import type { ZodType } from 'zod'

const IDEAS_KEY = 'OpenNapse:v0:ideas'
const PROJECTS_KEY = 'OpenNapse:v0:projects'
const TASKS_KEY = 'OpenNapse:v0:tasks'
const NOTES_KEY = 'OpenNapse:v0:notes'
const OUTBOX_KEY = 'OpenNapse:v0:sync-outbox'
const DEVICE_KEY = 'OpenNapse:v0:device-id'
const LOCAL_USER_KEY = 'OpenNapse:v0:local-user-id'
const WORKSPACES_KEY = 'OpenNapse:v0:workspaces'

function parseCollection<T>(records: unknown[], schema: ZodType<T>, key: string): T[] {
  const valid: T[] = []
  let rejected = 0
  let firstError: unknown = null
  for (const record of records) {
    const result = schema.safeParse(record)
    if (result.success) {
      valid.push(result.data)
      continue
    }
    rejected += 1
    if (firstError === null) firstError = result.error
  }
  if (rejected > 0) {
    logger.warn('local', `Skipped ${rejected} record(s) from "${key}" that failed schema validation`, { firstError })
  }
  return valid
}

function ensureStoredId(key: string): string {
  // Device + local-user ids stay on synchronous localStorage. They are a few
  // bytes each, stable per-install, and used from class field initializers,
  // so making them async would force a cascade of changes for no benefit.
  if (typeof localStorage === 'undefined') return crypto.randomUUID()
  const existing = localStorage.getItem(key)
  if (existing) return existing
  const id = crypto.randomUUID()
  localStorage.setItem(key, id)
  return id
}

function getDeviceId() {
  return ensureStoredId(DEVICE_KEY)
}

export function getLocalUserId() {
  return ensureStoredId(LOCAL_USER_KEY)
}

export class BrowserLocalAdapter implements DBAdapter {
  private readonly deviceId = getDeviceId()
  private readonly localUserId = getLocalUserId()
  private readonly backend: StorageBackend
  private activeWorkspaceId: string = LOCAL_PERSONAL_WORKSPACE_ID

  constructor(backend: StorageBackend = createDefaultStorageBackend()) {
    this.backend = backend
  }

  setActiveWorkspaceId(workspaceId: string) {
    this.activeWorkspaceId = workspaceId
  }

  private async readCollection<T>(key: string, schema: ZodType<T>): Promise<T[]> {
    const raw = await this.backend.read<unknown[]>(key, [])
    if (!Array.isArray(raw)) return []
    return parseCollection(raw, schema, key)
  }

  async listWorkspaces(): Promise<WorkspaceRecord[]> {
    const parsed = await this.readCollection(WORKSPACES_KEY, workspaceRecordSchema)
    if (parsed.length === 0) {
      // First ever read: seed the local default personal workspace so the UI
      // always has something to show. Writes the seeded value back so later
      // renames/deletes persist.
      const seeded = createDefaultPersonalWorkspaceRecord(this.localUserId)
      await this.backend.write(WORKSPACES_KEY, [seeded])
      return [seeded]
    }
    return parsed.sort((a, b) => {
      if (a.isDefault && !b.isDefault) return -1
      if (!a.isDefault && b.isDefault) return 1
      return a.name.localeCompare(b.name)
    })
  }

  async createWorkspace(input: CreateWorkspaceInput): Promise<WorkspaceRecord> {
    const record = createWorkspaceRecord(input, this.localUserId)
    const all = await this.listWorkspaces()
    await this.backend.write(WORKSPACES_KEY, [...all, record])
    return record
  }

  async renameWorkspace(id: string, name: string): Promise<WorkspaceRecord> {
    const all = await this.listWorkspaces()
    const existing = all.find((workspace) => workspace.id === id)
    if (!existing) throw new Error('Workspace not found')
    const updated = workspaceRecordSchema.parse({ ...existing, name: name.trim(), updatedAt: new Date().toISOString() })
    await this.backend.write(
      WORKSPACES_KEY,
      all.map((workspace) => (workspace.id === id ? updated : workspace)),
    )
    return updated
  }

  async deleteWorkspace(id: string): Promise<void> {
    if (id === LOCAL_PERSONAL_WORKSPACE_ID) throw new Error('Cannot delete the default personal workspace.')
    const all = await this.listWorkspaces()
    const next = all.filter((workspace) => workspace.id !== id)
    await this.backend.write(WORKSPACES_KEY, next)
    // Cascade-delete content belonging to the removed workspace.
    const [ideas, projects, tasks, notes] = await Promise.all([
      this.readCollection(IDEAS_KEY, ideaSchema),
      this.readCollection(PROJECTS_KEY, projectSchema),
      this.readCollection(TASKS_KEY, taskSchema),
      this.readCollection(NOTES_KEY, noteSchema),
    ])
    const byWorkspace = <T extends { workspaceId: string }>(items: T[]) => items.filter((item) => item.workspaceId !== id)
    const cascadeResults = await Promise.allSettled([
      this.backend.write(IDEAS_KEY, byWorkspace(ideas)),
      this.backend.write(PROJECTS_KEY, byWorkspace(projects)),
      this.backend.write(TASKS_KEY, byWorkspace(tasks)),
      this.backend.write(NOTES_KEY, byWorkspace(notes)),
    ])
    for (const r of cascadeResults) {
      if (r.status === 'rejected') logger.error('local', 'deleteWorkspace cascade write failed', { reason: r.reason })
    }
  }

  private context(): DraftContext {
    return {
      deviceId: this.deviceId,
      workspaceId: this.activeWorkspaceId,
      createdBy: this.localUserId,
    }
  }

  async listIdeas(): Promise<Idea[]> {
    const ideas = await this.readCollection(IDEAS_KEY, ideaSchema)
    return ideas
      .filter((idea) => !idea.isDeleted)
      .filter((idea) => idea.workspaceId === this.activeWorkspaceId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async createIdea(input: CreateIdeaInput): Promise<Idea> {
    const idea = createIdeaDraft(input, this.context())
    const all = await this.readCollection(IDEAS_KEY, ideaSchema)
    await this.backend.write(IDEAS_KEY, [idea, ...all])
    await this.enqueue('ideas', idea.id, 'insert', idea)
    return idea
  }

  async buryIdea(id: string): Promise<Idea> {
    return this.patchIdea(id, { status: 'buried', buriedAt: new Date().toISOString() })
  }

  async resurrectIdea(id: string): Promise<Idea> {
    return this.patchIdea(id, { status: 'raw', buriedAt: null, lastTouchedAt: new Date().toISOString() })
  }

  async moveIdeaToProject(id: string, projectId: string): Promise<Idea> {
    return this.patchIdea(id, { projectId, lastTouchedAt: new Date().toISOString() })
  }

  async listProjects(): Promise<Project[]> {
    const projects = await this.readCollection(PROJECTS_KEY, projectSchema)
    return projects
      .filter((project) => !project.isDeleted)
      .filter((project) => project.workspaceId === this.activeWorkspaceId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async createProject(input: CreateProjectInput): Promise<Project> {
    const project = createProjectDraft(input, this.context())
    const all = await this.readCollection(PROJECTS_KEY, projectSchema)
    await this.backend.write(PROJECTS_KEY, [project, ...all])
    await this.enqueue('projects', project.id, 'insert', project)
    return project
  }

  async listTasks(): Promise<Task[]> {
    const tasks = await this.readCollection(TASKS_KEY, taskSchema)
    return tasks
      .filter((task) => !task.isDeleted)
      .filter((task) => task.workspaceId === this.activeWorkspaceId)
      .sort((a, b) => a.sortOrder - b.sortOrder)
  }

  async listNotes(): Promise<Note[]> {
    const notes = await this.readCollection(NOTES_KEY, noteSchema)
    return notes
      .filter((note) => !note.isDeleted)
      .filter((note) => note.workspaceId === this.activeWorkspaceId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async createTask(input: CreateTaskInput): Promise<Task> {
    const task = createTaskDraft(input, this.context())
    const all = await this.readCollection(TASKS_KEY, taskSchema)
    await this.backend.write(TASKS_KEY, [task, ...all])
    await this.enqueue('tasks', task.id, 'insert', task)
    return task
  }

  async promoteIdea(input: PromoteIdeaInput): Promise<{ idea: Idea; project: Project; task: Task }> {
    const project = createProjectFromIdea(input, this.context())
    const task = createFirstStepTask(project)
    const idea = await this.patchIdea(input.idea.id, { status: 'project', projectId: project.id, lastTouchedAt: new Date().toISOString() })
    const [projects, tasks] = await Promise.all([
      this.readCollection(PROJECTS_KEY, projectSchema),
      this.readCollection(TASKS_KEY, taskSchema),
    ])
    await Promise.all([
      this.backend.write(PROJECTS_KEY, [project, ...projects]),
      this.backend.write(TASKS_KEY, [task, ...tasks]),
    ])
    await this.enqueue('projects', project.id, 'insert', project)
    await this.enqueue('tasks', task.id, 'insert', task)

    return { idea, project, task }
  }

  async moveTask(id: string, columnId: TaskColumn): Promise<Task> {
    const tasks = await this.readCollection(TASKS_KEY, taskSchema)
    const existing = tasks.find((task) => task.id === id)
    if (!existing) throw new Error('Task not found')
    const updated = taskSchema.parse({
      ...existing,
      columnId,
      sortOrder: Date.now(),
      completedAt: columnId === 'done' ? new Date().toISOString() : null,
      completionPct: columnId === 'done' ? 100 : existing.completionPct,
      updatedAt: new Date().toISOString(),
      version: existing.version + 1,
    })
    await this.backend.write(TASKS_KEY, tasks.map((task) => (task.id === id ? updated : task)))
    await this.enqueue('tasks', updated.id, 'update', updated)
    return updated
  }

  async updateTask(id: string, input: UpdateTaskInput): Promise<Task> {
    const tasks = await this.readCollection(TASKS_KEY, taskSchema)
    const existing = tasks.find((task) => task.id === id)
    if (!existing) throw new Error('Task not found')
    const updated = taskSchema.parse({
      ...existing,
      ...input,
      updatedAt: new Date().toISOString(),
      version: existing.version + 1,
    })
    await this.backend.write(TASKS_KEY, tasks.map((task) => (task.id === id ? updated : task)))
    await this.enqueue('tasks', updated.id, 'update', updated)
    return updated
  }

  async upsertNote(input: UpsertNoteInput): Promise<Note> {
    const notes = await this.readCollection(NOTES_KEY, noteSchema)
    const existing = input.id ? notes.find((note) => note.id === input.id) : undefined
    const note = existing
      ? noteSchema.parse({ ...existing, ...input, updatedAt: new Date().toISOString(), version: existing.version + 1 })
      : createNoteDraft(input, this.context())

    await this.backend.write(NOTES_KEY, existing ? notes.map((item) => (item.id === note.id ? note : item)) : [note, ...notes])
    await this.enqueue('notes', note.id, existing ? 'update' : 'insert', note)
    return note
  }

  async deleteNote(id: string): Promise<void> {
    const notes = await this.readCollection(NOTES_KEY, noteSchema)
    const existing = notes.find((n) => n.id === id)
    if (!existing || existing.isDeleted) return
    const deleted = noteSchema.parse({ ...existing, isDeleted: true, updatedAt: new Date().toISOString(), version: existing.version + 1 })
    await this.backend.write(NOTES_KEY, notes.map((item) => (item.id === id ? deleted : item)))
    await this.enqueue('notes', id, 'update', deleted)
  }

  async exportData(): Promise<string> {
    return JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        version: 0,
        ideas: await this.listIdeas(),
        projects: await this.listProjects(),
        tasks: await this.listTasks(),
        notes: await this.listNotes(),
      },
      null,
      2,
    )
  }

  async importData(payload: string): Promise<void> {
    let parsed: { ideas?: unknown[]; projects?: unknown[]; tasks?: unknown[]; notes?: unknown[] }
    try {
      parsed = JSON.parse(payload)
    } catch (e) {
      logger.error('local', 'importData JSON parse failed', { error: String(e) })
      throw new Error('importData: invalid JSON', { cause: e })
    }
    let ideas: Idea[], projects: Project[], tasks: Task[], notes: Note[]
    try {
      ideas = (parsed.ideas ?? []).map((idea) => ideaSchema.parse(idea))
      projects = (parsed.projects ?? []).map((project) => projectSchema.parse(project))
      tasks = (parsed.tasks ?? []).map((task) => taskSchema.parse(task))
      notes = (parsed.notes ?? []).map((note) => noteSchema.parse(note))
    } catch (e) {
      logger.error('local', 'importData schema validation failed', { error: String(e) })
      throw new Error('importData: schema validation failed', { cause: e })
    }

    const importResults = await Promise.allSettled([
      this.backend.write(IDEAS_KEY, ideas),
      this.backend.write(PROJECTS_KEY, projects),
      this.backend.write(TASKS_KEY, tasks),
      this.backend.write(NOTES_KEY, notes),
    ])
    for (const r of importResults) {
      if (r.status === 'rejected') logger.error('local', 'importData write failed', { reason: r.reason })
    }
    await this.enqueue('backup', crypto.randomUUID(), 'insert', { importedAt: new Date().toISOString() })
  }

  async clearAllData(): Promise<void> {
    const clearResults = await Promise.allSettled([
      this.backend.remove(IDEAS_KEY),
      this.backend.remove(PROJECTS_KEY),
      this.backend.remove(TASKS_KEY),
      this.backend.remove(NOTES_KEY),
      this.backend.remove(OUTBOX_KEY),
    ])
    for (const r of clearResults) {
      if (r.status === 'rejected') logger.error('local', 'clearAllData remove failed', { reason: r.reason })
    }
  }

  async listOutbox(): Promise<SyncOutboxEntry[]> {
    const raw = await this.backend.read<SyncOutboxEntry[]>(OUTBOX_KEY, [])
    return Array.isArray(raw) ? raw : []
  }

  private async patchIdea(id: string, patch: Partial<Idea>): Promise<Idea> {
    const ideas = await this.readCollection(IDEAS_KEY, ideaSchema)
    const existing = ideas.find((idea) => idea.id === id)
    if (!existing) throw new Error('Idea not found')
    const updated = ideaSchema.parse({ ...existing, ...patch, updatedAt: new Date().toISOString(), version: existing.version + 1 })
    await this.backend.write(
      IDEAS_KEY,
      ideas.map((idea) => (idea.id === id ? updated : idea)),
    )
    await this.enqueue('ideas', updated.id, 'update', updated)
    return updated
  }

  private async enqueue(entry: SyncOutboxEntry['tableName'], recordId: string, operation: SyncOutboxEntry['operation'], payload: unknown) {
    const outbox = await this.backend.read<SyncOutboxEntry[]>(OUTBOX_KEY, [])
    const safeOutbox = Array.isArray(outbox) ? outbox : []
    safeOutbox.push({
      id: crypto.randomUUID(),
      tableName: entry,
      recordId,
      operation,
      payload,
      createdAt: new Date().toISOString(),
      retryCount: 0,
      lastError: null,
    })
    await this.backend.write(OUTBOX_KEY, safeOutbox)
  }
}

export const db = new BrowserLocalAdapter()
