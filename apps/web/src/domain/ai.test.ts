import { describe, expect, it } from 'vitest'
import { createIdeaDraft } from './ideas'
import { createProjectFromIdea } from './projects'
import { createFirstStepTask } from './tasks'
import { generateLocalAISuggestions } from './ai'

const ctx = { deviceId: 'device-test', workspaceId: 'local-personal-workspace', createdBy: 'user-test' }

describe('generateLocalAISuggestions', () => {
  it('produces private local suggestions from current data', () => {
    const idea = createIdeaDraft({ title: 'Automate weekly review' }, ctx)
    const project = createProjectFromIdea({ idea, whyNow: 'Review is useful', firstStep: 'Collect stats', doneLooksLike: 'A digest' }, ctx)
    const task = createFirstStepTask(project)

    const suggestions = generateLocalAISuggestions([idea], [project], [task])

    expect(suggestions.map((item) => item.title)).toContain('Promote candidate')
    expect(suggestions.map((item) => item.title)).toContain('Focus recommendation')
    expect(suggestions.map((item) => item.title)).toContain('Weekly digest')
  })
})
