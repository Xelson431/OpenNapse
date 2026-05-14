import type { Idea } from './ideas'
import type { Project } from './projects'
import type { Task } from './tasks'

export interface AppStats {
  ideasCreated: number
  projectsCreated: number
  tasksCompleted: number
  momentumScore: number
  ideaToRealityRatio: number
}

export function calculateStats(ideas: Idea[], projects: Project[], tasks: Task[]): AppStats {
  const tasksCompleted = tasks.filter((task) => task.columnId === 'done').length
  const ideasCreated = ideas.length
  const projectsCreated = projects.length
  const ideaToRealityRatio = ideasCreated === 0 ? 0 : Math.round((projectsCreated / ideasCreated) * 100)

  return {
    ideasCreated,
    projectsCreated,
    tasksCompleted,
    momentumScore: ideasCreated + projectsCreated * 3 + tasksCompleted * 2,
    ideaToRealityRatio,
  }
}
