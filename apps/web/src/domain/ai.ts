import type { Idea } from './ideas'
import type { Project } from './projects'
import type { Task } from './tasks'

export interface LocalAISuggestion {
  title: string
  body: string
  action: string
}

export function generateLocalAISuggestions(ideas: Idea[], projects: Project[], tasks: Task[]): LocalAISuggestion[] {
  const rawIdeas = ideas.filter((idea) => idea.status === 'raw')
  const staleTasks = tasks.filter((task) => task.columnId !== 'done').slice(0, 3)
  const suggestions: LocalAISuggestion[] = []

  if (rawIdeas[0]) {
    suggestions.push({
      title: 'Promote candidate',
      body: `“${rawIdeas[0].title}” is still raw. Convert it into a project if it has a concrete next step.`,
      action: 'Open Commitment Bridge',
    })
  }

  if (staleTasks[0]) {
    suggestions.push({
      title: 'Focus recommendation',
      body: `Start with “${staleTasks[0].title}” because it is already scoped as a task.`,
      action: 'Move to In Progress',
    })
  }

  suggestions.push({
    title: 'Weekly digest',
    body: `You captured ${ideas.length} ideas, formed ${projects.length} projects, and completed ${tasks.filter((task) => task.columnId === 'done').length} tasks.`,
    action: 'Review momentum',
  })

  return suggestions
}

export function enhanceIdeaTitle(title: string): string {
  let enhanced = title.trim()
  if (!enhanced) return enhanced

  // Capitalize first letter
  enhanced = enhanced.charAt(0).toUpperCase() + enhanced.slice(1)

  // Add ending punctuation if missing
  if (!/[.!?]$/.test(enhanced)) {
    enhanced += '.'
  }

  // For very short ideas, append a helpful expansion prompt
  const wordCount = enhanced.split(/\s+/).length
  if (wordCount < 6) {
    enhanced += ' Consider breaking this down into concrete next steps.'
  }

  return enhanced
}
