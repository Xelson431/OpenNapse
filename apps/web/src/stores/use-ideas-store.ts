import { create } from 'zustand'
import { assertDbSnapshotCurrent, captureDbSnapshot, getDb } from '../db/get-db'
import type { DBAdapter } from '../db/adapter'
import { assertWriteAllowed } from '../lib/rate-limiter'
import type { Idea, UpdateIdeaInput } from '../domain/ideas'

interface IdeasState {
  ideas: Idea[]
  isLoaded: boolean
  loadIdeas: (adapter?: DBAdapter, shouldCommit?: () => boolean) => Promise<void>
  resetIdeas: () => void
  createIdea: (input: { title: string; projectId?: string | null }) => Promise<void>
  updateIdea: (id: string, input: UpdateIdeaInput) => Promise<Idea>
  buryIdea: (id: string) => Promise<void>
  resurrectIdea: (id: string) => Promise<void>
  moveIdeaToProject: (id: string, projectId: string) => Promise<void>
  clearAllData: () => Promise<void>
}

export const useIdeasStore = create<IdeasState>((set, get) => ({
  ideas: [],
  isLoaded: false,
  loadIdeas: async (adapter = getDb(), shouldCommit) => {
    if (shouldCommit && !shouldCommit()) return
    set({ ideas: [], isLoaded: false })
    const ideas = await adapter.listIdeas()
    if (shouldCommit && !shouldCommit()) return
    set({ ideas, isLoaded: true })
  },
  resetIdeas: () => set({ ideas: [], isLoaded: false }),
  createIdea: async (input) => {
    const snapshot = captureDbSnapshot()
    assertWriteAllowed('createIdea')
    const idea = await snapshot.adapter.createIdea({ title: input.title, projectId: input.projectId ?? null })
    assertDbSnapshotCurrent(snapshot)
    set({ ideas: [idea, ...get().ideas] })
  },
  updateIdea: async (id, input) => {
    const snapshot = captureDbSnapshot()
    assertWriteAllowed('updateIdea')
    const updated = await snapshot.adapter.updateIdea(id, input)
    assertDbSnapshotCurrent(snapshot)
    set({ ideas: get().ideas.map((idea) => (idea.id === id ? updated : idea)) })
    return updated
  },
  buryIdea: async (id) => {
    const snapshot = captureDbSnapshot()
    assertWriteAllowed('buryIdea')
    const updated = await snapshot.adapter.buryIdea(id)
    assertDbSnapshotCurrent(snapshot)
    set({ ideas: get().ideas.map((idea) => (idea.id === id ? updated : idea)) })
  },
  resurrectIdea: async (id) => {
    const snapshot = captureDbSnapshot()
    assertWriteAllowed('resurrectIdea')
    const updated = await snapshot.adapter.resurrectIdea(id)
    assertDbSnapshotCurrent(snapshot)
    set({ ideas: get().ideas.map((idea) => (idea.id === id ? updated : idea)) })
  },
  moveIdeaToProject: async (id, projectId) => {
    const snapshot = captureDbSnapshot()
    assertWriteAllowed('moveIdeaToProject')
    const updated = await snapshot.adapter.moveIdeaToProject(id, projectId)
    assertDbSnapshotCurrent(snapshot)
    set({ ideas: get().ideas.map((idea) => (idea.id === id ? updated : idea)) })
  },
  clearAllData: async () => {
    const snapshot = captureDbSnapshot()
    assertWriteAllowed('clearAllData')
    await snapshot.adapter.clearAllData()
    assertDbSnapshotCurrent(snapshot)
    set({ ideas: [], isLoaded: true })
  },
}))
