import { create } from 'zustand'
import { getDb } from '../db/get-db'
import { assertWriteAllowed } from '../lib/rate-limiter'
import type { Idea } from '../domain/ideas'
import type { Note, UpsertNoteInput } from '../domain/notes'
import type { CreateProjectInput, Project, PromoteIdeaInput } from '../domain/projects'
import type { CreateTaskInput, Task, TaskColumn, UpdateTaskInput } from '../domain/tasks'

interface WorkspaceState {
  projects: Project[]
  tasks: Task[]
  notes: Note[]
  isLoaded: boolean
  loadWorkspace: () => Promise<void>
  createProject: (input: CreateProjectInput) => Promise<void>
  promoteIdea: (input: PromoteIdeaInput) => Promise<void>
  createTask: (input: CreateTaskInput) => Promise<void>
  moveTask: (id: string, columnId: TaskColumn) => Promise<void>
  updateTask: (id: string, input: UpdateTaskInput) => Promise<void>
  upsertNote: (input: UpsertNoteInput) => Promise<string>
  exportData: () => Promise<string>
  importData: (payload: string) => Promise<void>
  clearAllData: () => Promise<void>
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  projects: [],
  tasks: [],
  notes: [],
  isLoaded: false,
  loadWorkspace: async () => {
    const [projects, tasks, notes] = await Promise.all([getDb().listProjects(), getDb().listTasks(), getDb().listNotes()])
    set({ projects, tasks, notes, isLoaded: true })
  },
  createProject: async (input) => {
    assertWriteAllowed('createProject')
    const project = await getDb().createProject(input)
    set({ projects: [project, ...get().projects] })
  },
  promoteIdea: async (input) => {
    assertWriteAllowed('promoteIdea')
    const { project, task } = await getDb().promoteIdea(input)
    set({ projects: [project, ...get().projects], tasks: [task, ...get().tasks] })
  },
  createTask: async (input) => {
    assertWriteAllowed('createTask')
    const task = await getDb().createTask(input)
    set({ tasks: [task, ...get().tasks] })
  },
  moveTask: async (id, columnId) => {
    assertWriteAllowed('moveTask')
    const updated = await getDb().moveTask(id, columnId)
    set({ tasks: get().tasks.map((task) => (task.id === id ? updated : task)) })
  },
  updateTask: async (id, input) => {
    assertWriteAllowed('updateTask')
    const updated = await getDb().updateTask(id, input)
    set({ tasks: get().tasks.map((task) => (task.id === id ? updated : task)) })
  },
  upsertNote: async (input) => {
    assertWriteAllowed('upsertNote')
    const note = await getDb().upsertNote(input)
    const notes = get().notes
    const exists = notes.some((item) => item.id === note.id)
    set({ notes: exists ? notes.map((item) => (item.id === note.id ? note : item)) : [note, ...notes] })
    return note.id
  },
  exportData: async () => getDb().exportData(),
  importData: async (payload) => {
    assertWriteAllowed('importData')
    await getDb().importData(payload)
    await get().loadWorkspace()
  },
  clearAllData: async () => {
    assertWriteAllowed('clearAllData')
    await getDb().clearAllData()
    set({ projects: [], tasks: [], notes: [], isLoaded: true })
  },
}))

export function toPromoteInput(idea: Idea, whyNow: string, firstStep: string, doneLooksLike: string): PromoteIdeaInput {
  return { idea, whyNow, firstStep, doneLooksLike }
}
