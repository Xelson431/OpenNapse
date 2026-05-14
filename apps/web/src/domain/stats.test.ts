import { describe, expect, it } from 'vitest'
import { createIdeaDraft } from './ideas'
import { createProjectFromIdea } from './projects'
import { calculateStats } from './stats'
import { createFirstStepTask } from './tasks'

const ctx = { deviceId: 'device-test', workspaceId: 'local-personal-workspace', createdBy: 'user-test' }

describe('calculateStats', () => {
  it('calculates local momentum and idea-to-reality ratio', () => {
    const idea = createIdeaDraft({ title: 'Ship a useful local MVP' }, ctx)
    const project = createProjectFromIdea({ idea, whyNow: 'Now', firstStep: 'Start', doneLooksLike: 'Done' }, ctx)
    const task = { ...createFirstStepTask(project), columnId: 'done' as const, completionPct: 100 }

    const stats = calculateStats([idea], [project], [task])

    expect(stats.ideasCreated).toBe(1)
    expect(stats.projectsCreated).toBe(1)
    expect(stats.tasksCompleted).toBe(1)
    expect(stats.ideaToRealityRatio).toBe(100)
    expect(stats.momentumScore).toBe(6)
  })
})
