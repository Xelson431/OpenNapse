import { describe, expect, it } from 'vitest'
import { createPersonalWorkspaceBootstrapPlan } from './bootstrap'

describe('createPersonalWorkspaceBootstrapPlan', () => {
  it('creates profile, personal workspace, and owner membership rows', () => {
    const plan = createPersonalWorkspaceBootstrapPlan({
      user: { id: 'user-1', email: 'ada.lovelace@example.com' },
      now: '2026-05-09T00:00:00.000Z',
      workspaceId: 'workspace-1',
    })

    expect(plan.profile).toEqual({
      id: 'user-1',
      email: 'ada.lovelace@example.com',
      display_name: "ada lovelace's workspace",
      created_at: '2026-05-09T00:00:00.000Z',
      updated_at: '2026-05-09T00:00:00.000Z',
    })
    expect(plan.workspace).toMatchObject({
      id: 'workspace-1',
      type: 'personal',
      owner_user_id: 'user-1',
    })
    expect(plan.membership).toEqual({
      workspace_id: 'workspace-1',
      user_id: 'user-1',
      role: 'owner',
      status: 'active',
      created_at: '2026-05-09T00:00:00.000Z',
    })
  })

  it('uses safe defaults when email is unavailable', () => {
    const plan = createPersonalWorkspaceBootstrapPlan({
      user: { id: 'user-2' },
      now: '2026-05-09T00:00:00.000Z',
      workspaceId: 'workspace-2',
    })

    expect(plan.profile.email).toBeNull()
    expect(plan.profile.display_name).toBe('Personal workspace')
  })
})
