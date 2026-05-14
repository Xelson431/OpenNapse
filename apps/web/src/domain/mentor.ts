import type { Idea } from './ideas'
import type { Note } from './notes'
import type { Project } from './projects'
import type { Task } from './tasks'

export type MentorContext = {
  ideas: Idea[]
  projects: Project[]
  tasks: Task[]
  notes: Note[]
  ideasByProject: Record<string, Idea[]>
}

function recentTitles<T extends { title: string }>(items: T[], count = 3): string {
  return items.slice(0, count).map((item) => item.title).join(', ')
}

function findMatchingProject(message: string, projects: Project[]): Project | undefined {
  const lower = message.toLowerCase()
  return projects.find((project) => lower.includes(project.title.toLowerCase()))
}

function summarizeProject(project: Project, context: MentorContext): string {
  const projectTasks = context.tasks.filter((task) => task.projectId === project.id)
  const linkedIdeas = context.ideasByProject[project.id] ?? []
  const openTasks = projectTasks.filter((task) => task.columnId !== 'done')
  const nextTask = openTasks[0]?.title ?? project.firstStep
  return `${project.title} is ${project.status}. It has ${linkedIdeas.length} linked ideas and ${openTasks.length} open tasks. Best next move: ${nextTask}. Done looks like: ${project.doneLooksLike}.`
}

function summarizeFocus(context: MentorContext): string {
  const openTasks = context.tasks.filter((task) => task.columnId !== 'done')
  if (openTasks.length === 0) {
    return context.projects.length
      ? `You have ${context.projects.length} projects but no open tasks. I would turn the top project into a concrete next action.`
      : 'You do not have open tasks yet. Promote one idea or create one task so I can help you build momentum.'
  }

  const urgent = openTasks.filter((task) => task.priority === 'urgent' || task.priority === 'high')
  const inProgress = openTasks.filter((task) => task.columnId === 'in_progress')
  const suggested = [...inProgress, ...urgent, ...openTasks].slice(0, 3).map((task) => task.title)
  return `Your focus list is ${suggested.join(', ')}. You have ${inProgress.length} in progress and ${urgent.length} high-pressure tasks, so I would finish before starting anything new.`
}

function summarizeRisks(context: MentorContext): string {
  const coldIdeas = context.ideas.filter((idea) => {
    const ageDays = (Date.now() - new Date(idea.lastTouchedAt).getTime()) / 86_400_000
    return ageDays > 14 && idea.status !== 'buried'
  })
  const overloadedProjects = context.projects.filter((project) => context.tasks.filter((task) => task.projectId === project.id && task.columnId !== 'done').length >= 5)
  const stalled = context.tasks.filter((task) => task.columnId === 'review' || task.columnId === 'backlog').slice(0, 3).map((task) => task.title)

  const notes: string[] = []
  if (coldIdeas.length) notes.push(`${coldIdeas.length} ideas look stale and need a review or burial pass`)
  if (overloadedProjects.length) notes.push(`${overloadedProjects.length} projects have 5+ open tasks and may need narrowing`)
  if (stalled.length) notes.push(`stalled tasks include ${stalled.join(', ')}`)

  return notes.length
    ? `Main risks: ${notes.join('; ')}.`
    : 'No major risk cluster stands out. Your workspace looks reasonably contained right now.'
}

function summarizeIdeas(message: string, context: MentorContext): string {
  const project = findMatchingProject(message, context.projects)
  if (project) {
    const linkedIdeas = context.ideasByProject[project.id] ?? []
    return linkedIdeas.length
      ? `Ideas linked to ${project.title}: ${recentTitles(linkedIdeas, 5)}.`
      : `No ideas are linked to ${project.title} yet.`
  }

  const rawIdeas = context.ideas.filter((idea) => idea.status === 'raw')
  const activeIdeas = context.ideas.filter((idea) => idea.status === 'active' || idea.status === 'project')
  return `You have ${rawIdeas.length} raw ideas and ${activeIdeas.length} active or project-linked ideas. Most recent: ${recentTitles(context.ideas, 3) || 'none yet'}.`
}

function summarizeProjects(context: MentorContext): string {
  if (context.projects.length === 0) {
    return 'No projects yet. Promote an idea or create a folder and I can help you shape the first milestone.'
  }

  const active = context.projects.filter((project) => project.status === 'active' || project.status === 'planning')
  const shipped = context.projects.filter((project) => project.status === 'shipped').length
  return `You have ${context.projects.length} projects total, ${active.length} still in motion, and ${shipped} shipped. Current focus candidates: ${recentTitles(active.length ? active : context.projects)}.`
}

function summarizeNotes(context: MentorContext): string {
  return context.notes.length
    ? `You have ${context.notes.length} notes. Most recent note titles: ${recentTitles(context.notes, 3)}.`
    : 'No notes yet. If you want, I can help turn a project into a working note outline.'
}

export function generateMentorReply(message: string, context: MentorContext): string {
  const lower = message.toLowerCase()
  const matchedProject = findMatchingProject(message, context.projects)

  if (matchedProject) {
    return summarizeProject(matchedProject, context)
  }

  if (lower.includes('summary') || lower.includes('summarize') || lower.includes('overview')) {
    return `Workspace summary: ${context.ideas.length} ideas, ${context.projects.length} projects, ${context.tasks.length} tasks, ${context.notes.length} notes. ${summarizeFocus(context)} ${summarizeRisks(context)}`
  }

  if (lower.includes('focus') || lower.includes('next') || lower.includes('today') || lower.includes('priority')) {
    return summarizeFocus(context)
  }

  if (lower.includes('risk') || lower.includes('blocked') || lower.includes('stuck')) {
    return summarizeRisks(context)
  }

  if (lower.includes('idea')) {
    return summarizeIdeas(message, context)
  }

  if (lower.includes('project')) {
    return summarizeProjects(context)
  }

  if (lower.includes('note') || lower.includes('document')) {
    return summarizeNotes(context)
  }

  if (lower.includes('task')) {
    const open = context.tasks.filter((task) => task.columnId !== 'done').length
    const done = context.tasks.length - open
    return `You have ${open} open tasks and ${done} done tasks. ${summarizeFocus(context)}`
  }

  return `${summarizeProjects(context)} ${summarizeFocus(context)} ${summarizeRisks(context)}`
}
