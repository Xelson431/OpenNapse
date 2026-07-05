import type { CreateIdeaInput, Idea } from '../domain/ideas'
import type { Note, UpsertNoteInput } from '../domain/notes'
import type { CreateProjectInput, PromoteIdeaInput, Project } from '../domain/projects'
import type { CreateTaskInput, Task, TaskColumn, UpdateTaskInput } from '../domain/tasks'
import type { CreateWorkspaceInput, WorkspaceRecord } from '../domain/workspaces'

export interface SyncOutboxEntry {
  id: string
  tableName: 'ideas' | 'projects' | 'tasks' | 'notes' | 'links' | 'backup'
  recordId: string
  operation: 'insert' | 'update' | 'delete'
  payload: unknown
  createdAt: string
  retryCount: number
  lastError: string | null
}

export interface DBAdapter {
  setActiveWorkspaceId(workspaceId: string): void
  listWorkspaces(): Promise<WorkspaceRecord[]>
  createWorkspace(input: CreateWorkspaceInput): Promise<WorkspaceRecord>
  renameWorkspace(id: string, name: string): Promise<WorkspaceRecord>
  deleteWorkspace(id: string): Promise<void>
  listIdeas(): Promise<Idea[]>
  createIdea(input: CreateIdeaInput): Promise<Idea>
  buryIdea(id: string): Promise<Idea>
  resurrectIdea(id: string): Promise<Idea>
  moveIdeaToProject(id: string, projectId: string): Promise<Idea>
  listProjects(): Promise<Project[]>
  createProject(input: CreateProjectInput): Promise<Project>
  listTasks(): Promise<Task[]>
  listNotes(): Promise<Note[]>
  createTask(input: CreateTaskInput): Promise<Task>
  promoteIdea(input: PromoteIdeaInput): Promise<{ idea: Idea; project: Project; task: Task }>
  moveTask(id: string, columnId: TaskColumn): Promise<Task>
  updateTask(id: string, input: UpdateTaskInput): Promise<Task>
  upsertNote(input: UpsertNoteInput): Promise<Note>
  exportData(): Promise<string>
  importData(payload: string): Promise<void>
  clearAllData(): Promise<void>
  listOutbox(): Promise<SyncOutboxEntry[]>
}
