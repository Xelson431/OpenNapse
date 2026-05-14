import { describe, expect, it } from 'vitest'
import { createActiveWorkspace, LOCAL_PERSONAL_WORKSPACE_ID } from './workspaces'

describe('createActiveWorkspace', () => {
  it('creates the local-first personal workspace identity', () => {
    expect(createActiveWorkspace('personal')).toMatchObject({
      id: LOCAL_PERSONAL_WORKSPACE_ID,
      type: 'personal',
      mode: 'personal',
      syncEnabled: false,
    })
  })

  it('keeps team mode locked until auth and RLS exist', () => {
    expect(createActiveWorkspace('team-preview')).toMatchObject({
      id: 'team-preview-locked',
      type: 'team',
      mode: 'team-preview',
      syncEnabled: false,
    })
  })
})
