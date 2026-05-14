import { describe, expect, it } from 'vitest'
import { createIdeaDraft } from './ideas'
import { createProjectFromIdea } from './projects'
import { createFirstStepTask } from './tasks'

const ctx = { deviceId: 'device-test', workspaceId: 'local-personal-workspace', createdBy: 'user-test' }

describe('project promotion workflow', () => {
  it('creates a project and first task from an idea', () => {
    const idea = createIdeaDraft({ title: 'Launch a local-first knowledge base' }, ctx)
    const project = createProjectFromIdea(
      {
        idea,
        whyNow: 'The local foundation exists.',
        firstStep: 'Define the first offline workflow.',
        doneLooksLike: 'A usable offline project cockpit.',
      },
      ctx,
    )
    const task = createFirstStepTask(project)

    expect(project.sourceIdeaId).toBe(idea.id)
    expect(project.whyNow).toBe('The local foundation exists.')
    expect(task.projectId).toBe(project.id)
    expect(task.title).toBe('Define the first offline workflow.')
  })
})
