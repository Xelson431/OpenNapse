import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseBrowserClient } from '../lib/supabase'
import { ideaSchema, createIdeaDraft, type CreateIdeaInput, type Idea, type DraftContext } from '../domain/ideas'
import { noteSchema, createNoteDraft, type Note, type UpsertNoteInput } from '../domain/notes'
import {
  projectSchema,
  createProjectDraft,
  createProjectFromIdea,
  type CreateProjectInput,
  type Project,
  type PromoteIdeaInput,
} from '../domain/projects'
import {
  taskSchema,
  createTaskDraft,
  createFirstStepTask,
  type CreateTaskInput,
  type Task,
  type TaskColumn,
  type UpdateTaskInput,
} from '../domain/tasks'
import {
  workspaceRecordSchema,
  type CreateWorkspaceInput,
  type WorkspaceRecord,
} from '../domain/workspaces'
import { logger } from '../lib/logger'
import type { DBAdapter, SyncOutboxEntry } from './adapter'

export class CloudAdapterNotSignedInError extends Error {
  constructor(operation: string) {
    super(`Supabase cloud adapter cannot run "${operation}" without an authenticated session.`)
    this.name = 'CloudAdapterNotSignedInError'
  }
}

export class CloudAdapterMissingWorkspaceError extends Error {
  constructor() {
    super('Supabase cloud adapter requires an active workspace id before reading or writing.')
    this.name = 'CloudAdapterMissingWorkspaceError'
  }
}

export class CloudAdapterDisabledError extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = 'CloudAdapterDisabledError'
  }
}

// -------------------------------------------------------------------------
// Row <-> domain mappers. Postgres columns are snake_case; domain schemas
// are camelCase. Zod parse on the way back validates shape.
// -------------------------------------------------------------------------

type UnknownRow = Record<string, unknown>

function pickString(row: UnknownRow, key: string, fallback = ''): string {
  const value = row[key]
  return typeof value === 'string' ? value : fallback
}

function pickNumber(row: UnknownRow, key: string, fallback = 0): number {
  const value = row[key]
  return typeof value === 'number' ? value : fallback
}

function pickBoolean(row: UnknownRow, key: string, fallback = false): boolean {
  const value = row[key]
  return typeof value === 'boolean' ? value : fallback
}

function pickNullable<T>(row: UnknownRow, key: string, cast: (value: unknown) => T | null): T | null {
  const value = row[key]
  if (value === null || value === undefined) return null
  return cast(value)
}

function normalizeDate(value: unknown, fallback?: string): string {
  if (typeof value !== 'string') return fallback ?? new Date().toISOString()
  // Supabase returns timestamptz as ISO strings with microsecond precision and
  // short offset ("2024-01-15T10:30:00.000000+00") which Zod datetime rejects.
  return value.replace(/[+-]\d{2}(?::\d{2})?$/, 'Z')
}

function pickDate(row: UnknownRow, key: string, fallback?: string): string {
  return normalizeDate(row[key], fallback)
}

function rowToIdea(row: UnknownRow): Idea {
  return ideaSchema.parse({
    id: pickString(row, 'id'),
    logicalId: pickString(row, 'logical_id', pickString(row, 'id')),
    workspaceId: pickString(row, 'workspace_id'),
    createdBy: pickString(row, 'created_by'),
    title: pickString(row, 'title'),
    body: pickString(row, 'body', ''),
    status: pickString(row, 'status', 'raw'),
    projectId: pickNullable(row, 'project_id', (v) => (typeof v === 'string' ? v : null)),
    tags: Array.isArray(row.tags) ? (row.tags as string[]) : [],
    color: pickString(row, 'color', '#78716C'),
    energyLevel: pickNullable(row, 'energy_level', (v) => (typeof v === 'number' ? v : null)),
    mood: pickNullable(row, 'mood', (v) => (typeof v === 'string' ? v : null)),
    createdAt: pickDate(row, 'created_at'),
    updatedAt: pickDate(row, 'updated_at'),
    lastTouchedAt: pickDate(row, 'last_touched_at', pickDate(row, 'updated_at')),
    buriedAt: pickNullable(row, 'buried_at', (v) => (typeof v === 'string' ? normalizeDate(v) : null)),
    version: pickNumber(row, 'version', 1),
    clientId: pickString(row, 'client_id', 'cloud'),
    deviceId: pickString(row, 'device_id', 'cloud'),
    isDeleted: pickBoolean(row, 'is_deleted', false),
  })
}

function ideaToRow(idea: Idea): Record<string, unknown> {
  return {
    id: idea.id,
    logical_id: idea.logicalId ?? idea.id,
    workspace_id: idea.workspaceId,
    created_by: idea.createdBy,
    title: idea.title,
    body: idea.body,
    status: idea.status,
    project_id: idea.projectId,
    tags: idea.tags,
    color: idea.color,
    energy_level: idea.energyLevel,
    mood: idea.mood,
    created_at: idea.createdAt,
    updated_at: idea.updatedAt,
    last_touched_at: idea.lastTouchedAt,
    buried_at: idea.buriedAt,
    version: idea.version,
    client_id: idea.clientId,
    device_id: idea.deviceId,
    is_deleted: idea.isDeleted,
  }
}

function rowToProject(row: UnknownRow): Project {
  return projectSchema.parse({
    id: pickString(row, 'id'),
    logicalId: pickString(row, 'logical_id', pickString(row, 'id')),
    workspaceId: pickString(row, 'workspace_id'),
    createdBy: pickString(row, 'created_by'),
    title: pickString(row, 'title'),
    description: pickString(row, 'description', ''),
    sourceIdeaId: pickNullable(row, 'source_idea_id', (v) => (typeof v === 'string' ? v : null)),
    whyNow: pickString(row, 'why_now'),
    firstStep: pickString(row, 'first_step'),
    doneLooksLike: pickString(row, 'done_looks_like'),
    status: pickString(row, 'status', 'planning'),
    color: pickString(row, 'color', '#78716C'),
    createdAt: pickString(row, 'created_at'),
    updatedAt: pickString(row, 'updated_at'),
    version: pickNumber(row, 'version', 1),
    clientId: pickString(row, 'client_id', 'cloud'),
    deviceId: pickString(row, 'device_id', 'cloud'),
    isDeleted: pickBoolean(row, 'is_deleted', false),
  })
}

function projectToRow(project: Project): Record<string, unknown> {
  return {
    id: project.id,
    logical_id: project.logicalId ?? project.id,
    workspace_id: project.workspaceId,
    created_by: project.createdBy,
    title: project.title,
    description: project.description,
    source_idea_id: project.sourceIdeaId,
    why_now: project.whyNow,
    first_step: project.firstStep,
    done_looks_like: project.doneLooksLike,
    status: project.status,
    color: project.color,
    created_at: project.createdAt,
    updated_at: project.updatedAt,
    version: project.version,
    client_id: project.clientId,
    device_id: project.deviceId,
    is_deleted: project.isDeleted,
  }
}

function rowToTask(row: UnknownRow): Task {
  return taskSchema.parse({
    id: pickString(row, 'id'),
    logicalId: pickString(row, 'logical_id', pickString(row, 'id')),
    workspaceId: pickString(row, 'workspace_id'),
    createdBy: pickString(row, 'created_by'),
    title: pickString(row, 'title'),
    description: pickString(row, 'description', ''),
    projectId: pickString(row, 'project_id'),
    ideaId: pickNullable(row, 'idea_id', (v) => (typeof v === 'string' ? v : null)),
    columnId: pickString(row, 'column_id', 'backlog'),
    sortOrder: pickNumber(row, 'sort_order', 0),
    priority: pickString(row, 'priority', 'medium'),
    scheduledDate: pickNullable(row, 'scheduled_date', (v) => (typeof v === 'string' ? v : null)),
    dueDate: pickNullable(row, 'due_date', (v) => (typeof v === 'string' ? v : null)),
    completionPct: pickNumber(row, 'completion_pct', 0),
    createdAt: pickString(row, 'created_at'),
    updatedAt: pickString(row, 'updated_at'),
    completedAt: pickNullable(row, 'completed_at', (v) => (typeof v === 'string' ? v : null)),
    version: pickNumber(row, 'version', 1),
    clientId: pickString(row, 'client_id', 'cloud'),
    deviceId: pickString(row, 'device_id', 'cloud'),
    isDeleted: pickBoolean(row, 'is_deleted', false),
  })
}

function taskToRow(task: Task): Record<string, unknown> {
  return {
    id: task.id,
    logical_id: task.logicalId ?? task.id,
    workspace_id: task.workspaceId,
    created_by: task.createdBy,
    title: task.title,
    description: task.description,
    project_id: task.projectId,
    idea_id: task.ideaId,
    column_id: task.columnId,
    sort_order: task.sortOrder,
    priority: task.priority,
    scheduled_date: task.scheduledDate,
    due_date: task.dueDate,
    completion_pct: task.completionPct,
    created_at: task.createdAt,
    updated_at: task.updatedAt,
    completed_at: task.completedAt,
    version: task.version,
    client_id: task.clientId,
    device_id: task.deviceId,
    is_deleted: task.isDeleted,
  }
}

function rowToNote(row: UnknownRow): Note {
  return noteSchema.parse({
    id: pickString(row, 'id'),
    logicalId: pickString(row, 'logical_id', pickString(row, 'id')),
    workspaceId: pickString(row, 'workspace_id'),
    createdBy: pickString(row, 'created_by'),
    title: pickString(row, 'title'),
    content: pickString(row, 'content', ''),
    linkedIdeaId: pickNullable(row, 'linked_idea_id', (v) => (typeof v === 'string' ? v : null)),
    linkedProjectId: pickNullable(row, 'linked_project_id', (v) => (typeof v === 'string' ? v : null)),
    tags: Array.isArray(row.tags) ? (row.tags as string[]) : [],
    color: pickString(row, 'color', '#78716C'),
    voiceRecordings: Array.isArray(row.voice_recordings) ? (row.voice_recordings as unknown[]) : [],
    createdAt: pickDate(row, 'created_at'),
    updatedAt: pickDate(row, 'updated_at'),
    version: pickNumber(row, 'version', 1),
    clientId: pickString(row, 'client_id', 'cloud'),
    deviceId: pickString(row, 'device_id', 'cloud'),
    isDeleted: pickBoolean(row, 'is_deleted', false),
  })
}

function noteToRow(note: Note): Record<string, unknown> {
  return {
    id: note.id,
    logical_id: note.logicalId ?? note.id,
    workspace_id: note.workspaceId,
    created_by: note.createdBy,
    title: note.title,
    content: note.content,
    linked_idea_id: note.linkedIdeaId,
    linked_project_id: note.linkedProjectId,
    tags: note.tags,
    color: note.color,
    voice_recordings: note.voiceRecordings,
    created_at: note.createdAt,
    updated_at: note.updatedAt,
    version: note.version,
    client_id: note.clientId,
    device_id: note.deviceId,
    is_deleted: note.isDeleted,
  }
}

// -------------------------------------------------------------------------
// Adapter
// -------------------------------------------------------------------------

export class SupabaseCloudAdapter implements DBAdapter {
  private activeWorkspaceId: string | null = null
  private cachedUserId: string | null = null

  setActiveWorkspaceId(workspaceId: string) {
    this.activeWorkspaceId = workspaceId
  }

  async listWorkspaces(): Promise<WorkspaceRecord[]> {
    const client = this.requireClient('listWorkspaces')
    await this.requireUserId(client, 'listWorkspaces')
    const { data, error } = await client
      .from('workspaces')
      .select('id, type, name, owner_user_id, created_at, updated_at')
      .order('created_at', { ascending: true })
    if (error) {
      logger.error('cloud', 'listWorkspaces failed', { error: error.message })
      throw new Error(`listWorkspaces: ${error.message}`)
    }
    return (data ?? []).map((row) =>
      workspaceRecordSchema.parse({
        id: (row as UnknownRow).id,
        type: (row as UnknownRow).type,
        name: (row as UnknownRow).name,
        ownerUserId: (row as UnknownRow).owner_user_id,
        createdAt: normalizeDate((row as UnknownRow).created_at),
        updatedAt: normalizeDate((row as UnknownRow).updated_at),
        isDefault: false,
      }),
    )
  }

  async createWorkspace(input: CreateWorkspaceInput): Promise<WorkspaceRecord> {
    const client = this.requireClient('createWorkspace')
    await this.requireUserId(client, 'createWorkspace')
    const { data: createdRows, error } = await client.rpc('create_workspace', {
      requested_name: input.name.trim(),
      requested_type: input.type,
      idempotency_key: crypto.randomUUID(),
    })
    const created = (createdRows as Array<{ workspace_id: string }> | null)?.[0]
    if (error || !created) {
      logger.error('cloud', 'createWorkspace failed', { error: error?.message ?? 'No workspace returned.' })
      throw new Error(`createWorkspace: ${error?.message ?? 'No workspace returned.'}`)
    }
    const { data, error: readError } = await client
      .from('workspaces')
      .select('id, type, name, owner_user_id, created_at, updated_at')
      .eq('id', created.workspace_id)
      .single()
    if (readError || !data) {
      throw new Error(`createWorkspace readback: ${readError?.message ?? 'No workspace returned.'}`)
    }
    return workspaceRecordSchema.parse({
      id: (data as UnknownRow).id,
      type: (data as UnknownRow).type,
      name: (data as UnknownRow).name,
      ownerUserId: (data as UnknownRow).owner_user_id,
      createdAt: normalizeDate((data as UnknownRow).created_at),
      updatedAt: normalizeDate((data as UnknownRow).updated_at),
      isDefault: false,
    })
  }

  async renameWorkspace(id: string, name: string): Promise<WorkspaceRecord> {
    const client = this.requireClient('renameWorkspace')
    await this.requireUserId(client, 'renameWorkspace')
    const { data, error } = await client
      .from('workspaces')
      .update({ name: name.trim(), updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('id, type, name, owner_user_id, created_at, updated_at')
      .single()
    if (error || !data) {
      logger.error('cloud', 'renameWorkspace failed', { error: error?.message })
      throw new Error(`renameWorkspace: ${error?.message ?? 'no row'}`)
    }
    return workspaceRecordSchema.parse({
      id: (data as UnknownRow).id,
      type: (data as UnknownRow).type,
      name: (data as UnknownRow).name,
      ownerUserId: (data as UnknownRow).owner_user_id,
      createdAt: normalizeDate((data as UnknownRow).created_at),
      updatedAt: normalizeDate((data as UnknownRow).updated_at),
      isDefault: false,
    })
  }

  async deleteWorkspace(_id: string): Promise<void> {
    void _id
    // Cloud deletion is a delayed, cancelable lifecycle action. Direct adapter
    // deletion would bypass export/recovery and must stay unavailable.
    throw new CloudAdapterDisabledError('Cloud workspace deletion must use the dedicated deletion lifecycle flow.')
  }

  private requireWorkspace(): string {
    if (!this.activeWorkspaceId) throw new CloudAdapterMissingWorkspaceError()
    return this.activeWorkspaceId
  }

  private requireClient(operation: string): SupabaseClient {
    const client = getSupabaseBrowserClient()
    if (!client) throw new CloudAdapterDisabledError(`Supabase is not configured; "${operation}" requires cloud setup.`)
    return client
  }

  private async requireUserId(client: SupabaseClient, operation: string): Promise<string> {
    if (this.cachedUserId) return this.cachedUserId
    const { data, error } = await client.auth.getUser()
    if (error || !data.user) {
      logger.warn('cloud', `requireUserId failed for ${operation}`, { error: error?.message })
      throw new CloudAdapterNotSignedInError(operation)
    }
    this.cachedUserId = data.user.id
    return this.cachedUserId
  }

  private async draftContext(operation: string): Promise<DraftContext> {
    const client = this.requireClient(operation)
    const userId = await this.requireUserId(client, operation)
    return { deviceId: 'cloud', workspaceId: this.requireWorkspace(), createdBy: userId }
  }

  async listIdeas(): Promise<Idea[]> {
    const client = this.requireClient('listIdeas')
    await this.requireUserId(client, 'listIdeas')
    const { data, error } = await client
      .from('ideas')
      .select('*')
      .eq('workspace_id', this.requireWorkspace())
      .eq('is_deleted', false)
      .order('updated_at', { ascending: false })
    if (error) {
      logger.error('cloud', 'listIdeas failed', { error: error.message })
      throw new Error(`listIdeas: ${error.message}`)
    }
    return (data ?? []).map((row) => rowToIdea(row as UnknownRow))
  }

  async createIdea(input: CreateIdeaInput): Promise<Idea> {
    const client = this.requireClient('createIdea')
    const context = await this.draftContext('createIdea')
    const idea = createIdeaDraft(input, context)
    const { error } = await client.from('ideas').insert(ideaToRow(idea))
    if (error) {
      logger.error('cloud', 'createIdea failed', { error: error.message })
      throw new Error(`createIdea: ${error.message}`)
    }
    return idea
  }

  async buryIdea(id: string): Promise<Idea> {
    return this.patchIdea(id, { status: 'buried', buried_at: new Date().toISOString() })
  }

  async resurrectIdea(id: string): Promise<Idea> {
    return this.patchIdea(id, { status: 'raw', buried_at: null, last_touched_at: new Date().toISOString() })
  }

  async moveIdeaToProject(id: string, projectId: string): Promise<Idea> {
    return this.patchIdea(id, { project_id: projectId, last_touched_at: new Date().toISOString() })
  }

  private async patchIdea(id: string, patch: Record<string, unknown>): Promise<Idea> {
    const client = this.requireClient('patchIdea')
    await this.requireUserId(client, 'patchIdea')
    const { data, error } = await client
      .from('ideas')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('workspace_id', this.requireWorkspace())
      .select('*')
      .single()
    if (error || !data) {
      logger.error('cloud', 'patchIdea failed', { error: error?.message, id })
      throw new Error(`patchIdea: ${error?.message ?? 'no row'}`)
    }
    return rowToIdea(data as UnknownRow)
  }

  async listProjects(): Promise<Project[]> {
    const client = this.requireClient('listProjects')
    await this.requireUserId(client, 'listProjects')
    const { data, error } = await client
      .from('projects')
      .select('*')
      .eq('workspace_id', this.requireWorkspace())
      .eq('is_deleted', false)
      .order('updated_at', { ascending: false })
    if (error) {
      logger.error('cloud', 'listProjects failed', { error: error.message })
      throw new Error(`listProjects: ${error.message}`)
    }
    return (data ?? []).map((row) => rowToProject(row as UnknownRow))
  }

  async createProject(input: CreateProjectInput): Promise<Project> {
    const client = this.requireClient('createProject')
    const context = await this.draftContext('createProject')
    const project = createProjectDraft(input, context)
    const { error } = await client.from('projects').insert(projectToRow(project))
    if (error) {
      logger.error('cloud', 'createProject failed', { error: error.message })
      throw new Error(`createProject: ${error.message}`)
    }
    return project
  }

  async listTasks(): Promise<Task[]> {
    const client = this.requireClient('listTasks')
    await this.requireUserId(client, 'listTasks')
    const { data, error } = await client
      .from('tasks')
      .select('*')
      .eq('workspace_id', this.requireWorkspace())
      .eq('is_deleted', false)
      .order('sort_order', { ascending: true })
    if (error) {
      logger.error('cloud', 'listTasks failed', { error: error.message })
      throw new Error(`listTasks: ${error.message}`)
    }
    return (data ?? []).map((row) => rowToTask(row as UnknownRow))
  }

  async listNotes(): Promise<Note[]> {
    const client = this.requireClient('listNotes')
    await this.requireUserId(client, 'listNotes')
    const { data, error } = await client
      .from('notes')
      .select('*')
      .eq('workspace_id', this.requireWorkspace())
      .eq('is_deleted', false)
      .order('updated_at', { ascending: false })
    if (error) {
      logger.error('cloud', 'listNotes failed', { error: error.message })
      throw new Error(`listNotes: ${error.message}`)
    }
    return (data ?? []).map((row) => rowToNote(row as UnknownRow))
  }

  async createTask(input: CreateTaskInput): Promise<Task> {
    const client = this.requireClient('createTask')
    const context = await this.draftContext('createTask')
    const task = createTaskDraft(input, context)
    const { error } = await client.from('tasks').insert(taskToRow(task))
    if (error) {
      logger.error('cloud', 'createTask failed', { error: error.message })
      throw new Error(`createTask: ${error.message}`)
    }
    return task
  }

  async promoteIdea(input: PromoteIdeaInput): Promise<{ idea: Idea; project: Project; task: Task }> {
    const client = this.requireClient('promoteIdea')
    const context = await this.draftContext('promoteIdea')
    const project = createProjectFromIdea(input, context)
    const task = createFirstStepTask(project)

    const { error: projectError } = await client.from('projects').insert(projectToRow(project))
    if (projectError) {
      logger.error('cloud', 'promoteIdea project insert failed', { error: projectError.message })
      throw new Error(`promoteIdea(project): ${projectError.message}`)
    }

    const { error: taskError } = await client.from('tasks').insert(taskToRow(task))
    if (taskError) {
      logger.error('cloud', 'promoteIdea task insert failed', { error: taskError.message })
      throw new Error(`promoteIdea(task): ${taskError.message}`)
    }

    const idea = await this.patchIdea(input.idea.id, {
      status: 'project',
      project_id: project.id,
      last_touched_at: new Date().toISOString(),
    })

    return { idea, project, task }
  }

  async moveTask(id: string, columnId: TaskColumn): Promise<Task> {
    const client = this.requireClient('moveTask')
    await this.requireUserId(client, 'moveTask')
    const completed = columnId === 'done'
    const { data: existing, error: readError } = await client
      .from('tasks')
      .select('version, completion_pct')
      .eq('id', id)
      .eq('workspace_id', this.requireWorkspace())
      .single()
    if (readError || !existing) {
      logger.error('cloud', 'moveTask read failed', { error: readError?.message, id })
      throw new Error(`moveTask: ${readError?.message ?? 'not found'}`)
    }
    const nextVersion = (existing.version as number) + 1
    const { data, error } = await client
      .from('tasks')
      .update({
        column_id: columnId,
        sort_order: Date.now(),
        completed_at: completed ? new Date().toISOString() : null,
        completion_pct: completed ? 100 : existing.completion_pct,
        version: nextVersion,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('workspace_id', this.requireWorkspace())
      .select('*')
      .single()
    if (error || !data) {
      logger.error('cloud', 'moveTask update failed', { error: error?.message, id })
      throw new Error(`moveTask: ${error?.message ?? 'no row'}`)
    }
    return rowToTask(data as UnknownRow)
  }

  async updateTask(id: string, input: UpdateTaskInput): Promise<Task> {
    const client = this.requireClient('updateTask')
    await this.requireUserId(client, 'updateTask')
    const { data: existing, error: readError } = await client
      .from('tasks')
      .select('version')
      .eq('id', id)
      .eq('workspace_id', this.requireWorkspace())
      .single()
    if (readError || !existing) {
      logger.error('cloud', 'updateTask read failed', { error: readError?.message, id })
      throw new Error(`updateTask: ${readError?.message ?? 'not found'}`)
    }
    const patch: Record<string, unknown> = {
      version: ((existing.version as number | null) ?? 1) + 1,
      updated_at: new Date().toISOString(),
    }
    if (input.scheduledDate !== undefined) patch.scheduled_date = input.scheduledDate
    if (input.dueDate !== undefined) patch.due_date = input.dueDate
    const { data, error } = await client
      .from('tasks')
      .update(patch)
      .eq('id', id)
      .eq('workspace_id', this.requireWorkspace())
      .select('*')
      .single()
    if (error || !data) {
      logger.error('cloud', 'updateTask patch failed', { error: error?.message, id })
      throw new Error(`updateTask: ${error?.message ?? 'no row'}`)
    }
    return rowToTask(data as UnknownRow)
  }

  async upsertNote(input: UpsertNoteInput): Promise<Note> {
    const client = this.requireClient('upsertNote')
    const context = await this.draftContext('upsertNote')
    const draft = createNoteDraft(input, context)
    const note: Note = input.id ? { ...draft, id: input.id } : draft
    const { data, error } = await client.from('notes').upsert(noteToRow(note)).select('*').single()
    if (error || !data) {
      logger.error('cloud', 'upsertNote failed', { error: error?.message, title: input.title })
      throw new Error(`upsertNote: ${error?.message ?? 'no row'}`)
    }
    return rowToNote(data as UnknownRow)
  }

  async deleteNote(id: string): Promise<void> {
    const client = this.requireClient('deleteNote')
    const { error } = await client.from('notes').update({ is_deleted: true }).eq('id', id)
    if (error) {
      logger.error('cloud', 'deleteNote failed', { error: error.message, id })
      throw new Error(`deleteNote: ${error.message}`)
    }
  }

  async exportData(): Promise<string> {
    const [ideas, projects, tasks, notes] = await Promise.all([
      this.listIdeas(),
      this.listProjects(),
      this.listTasks(),
      this.listNotes(),
    ])
    return JSON.stringify(
      { exportedAt: new Date().toISOString(), version: 1, ideas, projects, tasks, notes },
      null,
      2,
    )
  }

  async importData(payload: string): Promise<void> {
    const client = this.requireClient('importData')
    const context = await this.draftContext('importData')
    let parsed: { ideas?: unknown[]; projects?: unknown[]; tasks?: unknown[]; notes?: unknown[] }
    try {
      parsed = JSON.parse(payload)
    } catch (e) {
      logger.error('cloud', 'importData JSON parse failed', { error: String(e) })
      throw new Error(`importData: invalid JSON`, { cause: e })
    }

    const ideas = (parsed.ideas ?? []).map((value) =>
      ideaSchema.parse({ ...(value as object), workspaceId: context.workspaceId, createdBy: context.createdBy }),
    )
    const projects = (parsed.projects ?? []).map((value) =>
      projectSchema.parse({ ...(value as object), workspaceId: context.workspaceId, createdBy: context.createdBy }),
    )
    const tasks = (parsed.tasks ?? []).map((value) =>
      taskSchema.parse({ ...(value as object), workspaceId: context.workspaceId, createdBy: context.createdBy }),
    )
    const notes = (parsed.notes ?? []).map((value) =>
      noteSchema.parse({ ...(value as object), workspaceId: context.workspaceId, createdBy: context.createdBy }),
    )

    if (projects.length > 0) {
      const { error } = await client.from('projects').upsert(projects.map(projectToRow))
      if (error) {
      logger.error('cloud', 'importData projects failed', { error: error.message })
      throw new Error(`importData(projects): ${error.message}`)
    }
    }
    if (ideas.length > 0) {
      const { error } = await client.from('ideas').upsert(ideas.map(ideaToRow))
      if (error) {
      logger.error('cloud', 'importData ideas failed', { error: error.message })
      throw new Error(`importData(ideas): ${error.message}`)
    }
    }
    if (tasks.length > 0) {
      const { error } = await client.from('tasks').upsert(tasks.map(taskToRow))
      if (error) {
      logger.error('cloud', 'importData tasks failed', { error: error.message })
      throw new Error(`importData(tasks): ${error.message}`)
    }
    }
    if (notes.length > 0) {
      const { error } = await client.from('notes').upsert(notes.map(noteToRow))
      if (error) {
      logger.error('cloud', 'importData notes failed', { error: error.message })
      throw new Error(`importData(notes): ${error.message}`)
    }
    }
  }

  async clearAllData(): Promise<void> {
    const client = this.requireClient('clearAllData')
    const workspaceId = this.requireWorkspace()
    const results = await Promise.allSettled([
      client.from('ideas').delete().eq('workspace_id', workspaceId),
      client.from('projects').delete().eq('workspace_id', workspaceId),
      client.from('tasks').delete().eq('workspace_id', workspaceId),
      client.from('notes').delete().eq('workspace_id', workspaceId),
    ])
    for (const result of results) {
      if (result.status === 'rejected') {
        logger.error('cloud', 'clearAllData delete failed', { reason: result.reason })
      }
    }
  }

  async listOutbox(): Promise<SyncOutboxEntry[]> {
    // Cloud adapter has no local outbox; writes go straight to Supabase.
    return []
  }

}

export function createSupabaseCloudAdapter(): DBAdapter {
  return new SupabaseCloudAdapter()
}
