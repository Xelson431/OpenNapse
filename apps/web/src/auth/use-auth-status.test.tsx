import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../config/env', () => ({
  getSupabaseEnv: () => ({
    configured: false,
    mode: 'missing',
    message: 'Supabase not configured yet.',
  }),
}))

vi.mock('../lib/supabase', () => ({
  getSupabaseBrowserClient: () => null,
}))

import { useAuthStatus } from './use-auth-status'

function Probe() {
  const status = useAuthStatus()
  return <span>{status.label}</span>
}

describe('useAuthStatus', () => {
  it('reports unavailable when Supabase env is missing', () => {
    render(<Probe />)
    expect(screen.getByText('Supabase unavailable')).toBeInTheDocument()
  })
})
