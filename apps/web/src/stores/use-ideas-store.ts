import { create } from 'zustand'
import { db } from '../db/browser-local-adapter'
import type { Idea } from '../domain/ideas'

interface IdeasState {
  ideas: Idea[]
  isLoaded: boolean
  loadIdeas: () => Promise<void>
  createIdea: (input: { title: string; projectId?: string | null }) => Promise<void>
  buryIdea: (id: string) => Promise<void>
  resurrectIdea: (id: string) => Promise<void>
  moveIdeaToProject: (id: string, projectId: string) => Promise<void>
  clearAllData: () => Promise<void>
}

export const useIdeasStore = create<IdeasState>((set, get) => ({
  ideas: [],
  isLoaded: false,
  loadIdeas: async () => {
    const ideas = await db.listIdeas()
    set({ ideas, isLoaded: true })
  },
  createIdea: async (input) => {
    const idea = await db.createIdea({ title: input.title, projectId: input.projectId ?? null })
    set({ ideas: [idea, ...get().ideas] })
  },
  buryIdea: async (id) => {
    const updated = await db.buryIdea(id)
    set({ ideas: get().ideas.map((idea) => (idea.id === id ? updated : idea)) })
  },
  resurrectIdea: async (id) => {
    const updated = await db.resurrectIdea(id)
    set({ ideas: get().ideas.map((idea) => (idea.id === id ? updated : idea)) })
  },
  moveIdeaToProject: async (id, projectId) => {
    const updated = await db.moveIdeaToProject(id, projectId)
    set({ ideas: get().ideas.map((idea) => (idea.id === id ? updated : idea)) })
  },
  clearAllData: async () => {
    await db.clearAllData()
    set({ ideas: [], isLoaded: true })
  },
}))
