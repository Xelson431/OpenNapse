import { describe, expect, it } from 'vitest'
import { resolveSupabaseEnv } from './env'

describe('resolveSupabaseEnv', () => {
  it('reports missing config when no variables are present', () => {
    expect(resolveSupabaseEnv({})).toMatchObject({
      configured: false,
      mode: 'missing',
    })
  })

  it('reports partial config when only one variable is present', () => {
    expect(resolveSupabaseEnv({ VITE_SUPABASE_URL: 'https://demo.supabase.co' })).toMatchObject({
      configured: false,
      mode: 'partial',
    })
  })

  it('rejects invalid URLs', () => {
    expect(resolveSupabaseEnv({
      VITE_SUPABASE_URL: 'not-a-url',
      VITE_SUPABASE_ANON_KEY: 'anon-key',
    })).toMatchObject({
      configured: false,
      mode: 'invalid',
    })
  })

  it('returns project metadata when config is valid', () => {
    expect(resolveSupabaseEnv({
      VITE_SUPABASE_URL: 'https://demo-project.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'anon-key',
    })).toMatchObject({
      configured: true,
      mode: 'configured',
      projectHost: 'demo-project.supabase.co',
    })
  })
})
