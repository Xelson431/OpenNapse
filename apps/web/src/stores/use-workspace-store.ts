import { create } from 'zustand'
import { db } from '../db/browser-local-adapter'
import type { Idea } from '../domain/ideas'
import type { Note, UpsertNoteInput } from '../domain/notes'
import type { CreateProjectInput, Project, PromoteIdeaInput } from '../domain/projects'
import type { CreateTaskInput, Task, TaskColumn } from '../domain/tasks'

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
    const [projects, tasks, notes] = await Promise.all([db.listProjects(), db.listTasks(), db.listNotes()])
    set({ projects, tasks, notes, isLoaded: true })
  },
  createProject: async (input) => {
    const project = await db.createProject(input)
    set({ projects: [project, ...get().projects] })
  },
  promoteIdea: async (input) => {
    const { project, task } = await db.promoteIdea(input)
    set({ projects: [project, ...get().projects], tasks: [task, ...get().tasks] })
  },
  createTask: async (input) => {
    const task = await db.createTask(input)
    set({ tasks: [task, ...get().tasks] })
  },
  moveTask: async (id, columnId) => {
    const updated = await db.moveTask(id, columnId)
    set({ tasks: get().tasks.map((task) => (task.id === id ? updated : task)) })
  },
  upsertNote: async (input) => {
    const note = await db.upsertNote(input)
    const notes = get().notes
    const exists = notes.some((item) => item.id === note.id)
    set({ notes: exists ? notes.map((item) => (item.id === note.id ? note : item)) : [note, ...notes] })
    return note.id
  },
  exportData: async () => db.exportData(),
  importData: async (payload) => {
    await db.importData(payload)
    await get().loadWorkspace()
  },
  clearAllData: async () => {
    await db.clearAllData()
    set({ projects: [], tasks: [], notes: [], isLoaded: true })
  },
}))

export function toPromoteInput(idea: Idea, whyNow: string, firstStep: string, doneLooksLike: string): PromoteIdeaInput {
  return { idea, whyNow, firstStep, doneLooksLike }
}
