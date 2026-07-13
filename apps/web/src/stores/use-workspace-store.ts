import { create } from 'zustand'
import { assertDbSnapshotCurrent, captureDbSnapshot, getDb } from '../db/get-db'
import type { DBAdapter } from '../db/adapter'
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
  loadWorkspace: (adapter?: DBAdapter, shouldCommit?: () => boolean) => Promise<void>
  resetWorkspace: () => void
  createProject: (input: CreateProjectInput) => Promise<void>
  promoteIdea: (input: PromoteIdeaInput) => Promise<void>
  createTask: (input: CreateTaskInput) => Promise<void>
  moveTask: (id: string, columnId: TaskColumn) => Promise<void>
  updateTask: (id: string, input: UpdateTaskInput) => Promise<void>
  upsertNote: (input: UpsertNoteInput) => Promise<string>
  deleteNote: (id: string) => Promise<void>
  exportData: () => Promise<string>
  importData: (payload: string) => Promise<void>
  clearAllData: () => Promise<void>
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  projects: [],
  tasks: [],
  notes: [],
  isLoaded: false,
  loadWorkspace: async (adapter = getDb(), shouldCommit) => {
    if (shouldCommit && !shouldCommit()) return
    set({ projects: [], tasks: [], notes: [], isLoaded: false })
    const [projects, tasks, notes] = await Promise.all([adapter.listProjects(), adapter.listTasks(), adapter.listNotes()])
    if (shouldCommit && !shouldCommit()) return
    set({ projects, tasks, notes, isLoaded: true })
  },
  resetWorkspace: () => set({ projects: [], tasks: [], notes: [], isLoaded: false }),
  createProject: async (input) => {
    const snapshot = captureDbSnapshot()
    assertWriteAllowed('createProject')
    const project = await snapshot.adapter.createProject(input)
    assertDbSnapshotCurrent(snapshot)
    set({ projects: [project, ...get().projects] })
  },
  promoteIdea: async (input) => {
    const snapshot = captureDbSnapshot()
    assertWriteAllowed('promoteIdea')
    const { project, task } = await snapshot.adapter.promoteIdea(input)
    assertDbSnapshotCurrent(snapshot)
    set({ projects: [project, ...get().projects], tasks: [task, ...get().tasks] })
  },
  createTask: async (input) => {
    const snapshot = captureDbSnapshot()
    assertWriteAllowed('createTask')
    const task = await snapshot.adapter.createTask(input)
    assertDbSnapshotCurrent(snapshot)
    set({ tasks: [task, ...get().tasks] })
  },
  moveTask: async (id, columnId) => {
    const snapshot = captureDbSnapshot()
    assertWriteAllowed('moveTask')
    const updated = await snapshot.adapter.moveTask(id, columnId)
    assertDbSnapshotCurrent(snapshot)
    set({ tasks: get().tasks.map((task) => (task.id === id ? updated : task)) })
  },
  updateTask: async (id, input) => {
    const snapshot = captureDbSnapshot()
    assertWriteAllowed('updateTask')
    const updated = await snapshot.adapter.updateTask(id, input)
    assertDbSnapshotCurrent(snapshot)
    set({ tasks: get().tasks.map((task) => (task.id === id ? updated : task)) })
  },
  upsertNote: async (input) => {
    const snapshot = captureDbSnapshot()
    assertWriteAllowed('upsertNote')
    const note = await snapshot.adapter.upsertNote(input)
    assertDbSnapshotCurrent(snapshot)
    const notes = get().notes
    const exists = notes.some((item) => item.id === note.id)
    set({ notes: exists ? notes.map((item) => (item.id === note.id ? note : item)) : [note, ...notes] })
    return note.id
  },
  deleteNote: async (id) => {
    const snapshot = captureDbSnapshot()
    assertWriteAllowed('deleteNote')
    await snapshot.adapter.deleteNote(id)
    assertDbSnapshotCurrent(snapshot)
    set({ notes: get().notes.filter((n) => n.id !== id) })
  },
  exportData: async () => {
    const snapshot = captureDbSnapshot()
    const data = await snapshot.adapter.exportData()
    assertDbSnapshotCurrent(snapshot)
    return data
  },
  importData: async (payload) => {
    const snapshot = captureDbSnapshot()
    assertWriteAllowed('importData')
    await snapshot.adapter.importData(payload)
    assertDbSnapshotCurrent(snapshot)
  },
  clearAllData: async () => {
    const snapshot = captureDbSnapshot()
    assertWriteAllowed('clearAllData')
    await snapshot.adapter.clearAllData()
    assertDbSnapshotCurrent(snapshot)
    set({ projects: [], tasks: [], notes: [], isLoaded: true })
  },
}))

export function toPromoteInput(idea: Idea, whyNow: string, firstStep: string, doneLooksLike: string): PromoteIdeaInput {
  return { idea, whyNow, firstStep, doneLooksLike }
}
