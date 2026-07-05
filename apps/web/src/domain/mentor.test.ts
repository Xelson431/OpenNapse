import { describe, expect, it } from 'vitest'
import { generateMentorReply, type MentorContext } from './mentor'

const now = '2026-05-09T00:00:00.000Z'

const context: MentorContext = {
  ideas: [
    { id: '11111111-1111-4111-8111-111111111111', workspaceId: 'local-personal-workspace', createdBy: 'u', title: 'Refine Mentor', body: '', status: 'project', projectId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', tags: ['ai'], color: '#78716C', energyLevel: null, mood: null, createdAt: now, updatedAt: now, lastTouchedAt: now, buriedAt: null, version: 1, clientId: 'c', deviceId: 'd', isDeleted: false },
    { id: '22222222-2222-4222-8222-222222222222', workspaceId: 'local-personal-workspace', createdBy: 'u', title: 'Old backlog idea', body: '', status: 'raw', projectId: null, tags: [], color: '#78716C', energyLevel: null, mood: null, createdAt: now, updatedAt: now, lastTouchedAt: '2026-04-01T00:00:00.000Z', buriedAt: null, version: 1, clientId: 'c', deviceId: 'd', isDeleted: false },
  ],
  projects: [
    { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', workspaceId: 'local-personal-workspace', createdBy: 'u', title: 'Mentor Upgrade', description: '', sourceIdeaId: null, whyNow: 'Users need it', firstStep: 'Draft richer reply engine', doneLooksLike: 'Mentor responds with context', status: 'active', color: '#78716C', createdAt: now, updatedAt: now, version: 1, clientId: 'c', deviceId: 'd', isDeleted: false },
  ],
  tasks: [
    { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', workspaceId: 'local-personal-workspace', createdBy: 'u', title: 'Draft richer reply engine', description: '', projectId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ideaId: null, columnId: 'in_progress', sortOrder: 1, priority: 'high', scheduledDate: null, dueDate: null, completionPct: 20, createdAt: now, updatedAt: now, completedAt: null, version: 1, clientId: 'c', deviceId: 'd', isDeleted: false },
    { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', workspaceId: 'local-personal-workspace', createdBy: 'u', title: 'Polish mentor tests', description: '', projectId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ideaId: null, columnId: 'review', sortOrder: 2, priority: 'medium', scheduledDate: null, dueDate: null, completionPct: 80, createdAt: now, updatedAt: now, completedAt: null, version: 1, clientId: 'c', deviceId: 'd', isDeleted: false },
  ],
  notes: [
    { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', workspaceId: 'local-personal-workspace', createdBy: 'u', title: 'Mentor notes', content: '', linkedIdeaId: null, linkedProjectId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', tags: [], color: '#78716C', voiceRecordings: [], createdAt: now, updatedAt: now, version: 1, clientId: 'c', deviceId: 'd', isDeleted: false },
  ],
  ideasByProject: {
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa': [
      { id: '11111111-1111-4111-8111-111111111111', workspaceId: 'local-personal-workspace', createdBy: 'u', title: 'Refine Mentor', body: '', status: 'project', projectId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', tags: ['ai'], color: '#78716C', energyLevel: null, mood: null, createdAt: now, updatedAt: now, lastTouchedAt: now, buriedAt: null, version: 1, clientId: 'c', deviceId: 'd', isDeleted: false },
    ],
  },
}

describe('generateMentorReply', () => {
  it('returns project-specific context when a project is named', () => {
    const reply = generateMentorReply('What is happening in Mentor Upgrade?', context)
    expect(reply).toMatch(/Mentor Upgrade is active/i)
    expect(reply).toMatch(/Draft richer reply engine/i)
  })

  it('returns a focus-oriented answer for next-step prompts', () => {
    const reply = generateMentorReply('What should I focus on today?', context)
    expect(reply).toMatch(/focus list/i)
    expect(reply).toMatch(/Draft richer reply engine/i)
  })

  it('surfaces risk signals from stale ideas and stalled tasks', () => {
    const reply = generateMentorReply('Any risks?', context)
    expect(reply).toMatch(/ideas look stale/i)
    expect(reply).toMatch(/Polish mentor tests/i)
  })
})
