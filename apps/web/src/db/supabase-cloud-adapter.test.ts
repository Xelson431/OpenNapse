import { describe, expect, it } from 'vitest'
import { CloudAdapterDisabledError, createSupabaseCloudAdapter } from './supabase-cloud-adapter'

describe('SupabaseCloudAdapter', () => {
  it('refuses reads when Supabase is not configured', async () => {
    const adapter = createSupabaseCloudAdapter()
    adapter.setActiveWorkspaceId('test-workspace')
    await expect(adapter.listIdeas()).rejects.toBeInstanceOf(CloudAdapterDisabledError)
  })

  it('refuses writes when Supabase is not configured', async () => {
    const adapter = createSupabaseCloudAdapter()
    adapter.setActiveWorkspaceId('test-workspace')
    await expect(
      adapter.createProject({
        title: 'Cloud project',
        whyNow: 'Cloud sync is ready',
        firstStep: 'Run migrations',
        doneLooksLike: 'RLS tests pass',
      }),
    ).rejects.toThrow(/Supabase is not configured/i)
  })
})
