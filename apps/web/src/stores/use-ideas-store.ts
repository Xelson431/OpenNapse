import { create } from 'zustand'
import { getDb } from '../db/get-db'
import { assertWriteAllowed } from '../lib/rate-limiter'
import type { Idea, UpdateIdeaInput } from '../domain/ideas'

interface IdeasState {
  ideas: Idea[]
  isLoaded: boolean
  loadIdeas: () => Promise<void>
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
  loadIdeas: async () => {
    const ideas = await getDb().listIdeas()
    set({ ideas, isLoaded: true })
  },
  createIdea: async (input) => {
    assertWriteAllowed('createIdea')
    const idea = await getDb().createIdea({ title: input.title, projectId: input.projectId ?? null })
    set({ ideas: [idea, ...get().ideas] })
  },
  updateIdea: async (id, input) => {
    assertWriteAllowed('updateIdea')
    const updated = await getDb().updateIdea(id, input)
    set({ ideas: get().ideas.map((idea) => (idea.id === id ? updated : idea)) })
    return updated
  },
  buryIdea: async (id) => {
    assertWriteAllowed('buryIdea')
    const updated = await getDb().buryIdea(id)
    set({ ideas: get().ideas.map((idea) => (idea.id === id ? updated : idea)) })
  },
  resurrectIdea: async (id) => {
    assertWriteAllowed('resurrectIdea')
    const updated = await getDb().resurrectIdea(id)
    set({ ideas: get().ideas.map((idea) => (idea.id === id ? updated : idea)) })
  },
  moveIdeaToProject: async (id, projectId) => {
    assertWriteAllowed('moveIdeaToProject')
    const updated = await getDb().moveIdeaToProject(id, projectId)
    set({ ideas: get().ideas.map((idea) => (idea.id === id ? updated : idea)) })
  },
  clearAllData: async () => {
    assertWriteAllowed('clearAllData')
    await getDb().clearAllData()
    set({ ideas: [], isLoaded: true })
  },
}))
