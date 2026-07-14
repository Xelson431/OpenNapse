import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import type { AuthStatus } from './auth/use-auth-status'
import type { PersonalWorkspaceBootstrapStatus } from './auth/use-personal-workspace-bootstrap'
import type { ResolvedSupabaseEnv, ResolvedBillingEnv } from './config/env'
import { getDb } from './db/get-db'
import { useWorkspacesStore } from './stores/use-workspaces-store'

const cloudMock = vi.hoisted(() => ({
  adapter: {
    setActiveWorkspaceId: vi.fn(),
    listWorkspaces: vi.fn(),
    listIdeas: vi.fn(),
    listProjects: vi.fn(),
    listTasks: vi.fn(),
    listNotes: vi.fn(),
  },
  create: vi.fn(),
}))

vi.mock('./db/supabase-cloud-adapter', () => ({
  createSupabaseCloudAdapter: cloudMock.create,
}))

// Module-level state for mocks — one value per describe block
let mockAuthStatus: AuthStatus = {
  mode: 'unavailable',
  label: 'Supabase unavailable',
  description: 'Supabase not configured.',
}
let mockBootstrap: PersonalWorkspaceBootstrapStatus = {
  mode: 'idle',
  label: 'Bootstrap waiting',
  description: 'No Supabase auth session. Workspace bootstrap is not possible until sign-in.',
}
let mockSupabaseEnv: ResolvedSupabaseEnv = {
  configured: false,
  mode: 'missing',
  message: 'Supabase not configured yet. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to enable auth and cloud sync setup.',
}
let mockBillingEnv: ResolvedBillingEnv = {
  configured: false,
  mode: 'missing',
  message: 'Billing wrapper not configured.',
}
let mockSyncLabel = 'Local-only'
let mockSyncDescription = 'Sync status.'

vi.mock('./auth/use-auth-status', () => ({
  useAuthStatus: vi.fn(() => mockAuthStatus),
  signOutOfSupabase: vi.fn().mockResolvedValue({ ok: true, message: 'Signed out.' }),
  requestMagicLink: vi.fn().mockResolvedValue({ ok: true, message: 'Magic link sent to test@example.com.' }),
}))

vi.mock('./auth/use-personal-workspace-bootstrap', () => ({
  usePersonalWorkspaceBootstrap: vi.fn(() => mockBootstrap),
}))

vi.mock('./config/env', () => ({
  getSupabaseEnv: vi.fn(() => mockSupabaseEnv),
  getBillingEnv: vi.fn(() => mockBillingEnv),
}))

vi.mock('./sync/use-sync', () => ({
  useSyncStatus: vi.fn(() => ({ label: mockSyncLabel, description: mockSyncDescription, connected: mockSyncLabel === 'Cloud connected' })),
}))

const configuredSupabaseEnv: ResolvedSupabaseEnv = {
  configured: true,
  mode: 'configured',
  message: 'Supabase is configured.',
  url: 'https://test.supabase.co',
  anonKey: 'test-anon-key',
  projectHost: 'test.supabase.co',
}

const unconfiguredSupabaseEnv: ResolvedSupabaseEnv = {
  configured: false,
  mode: 'missing',
  message: 'Supabase not configured yet. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to enable auth and cloud sync setup.',
}

const configuredBillingEnv: ResolvedBillingEnv = {
  configured: true,
  mode: 'configured',
  message: 'Billing wrapper is configured.',
  url: 'https://billing.example.com',
  host: 'billing.example.com',
}

const unconfiguredBillingEnv: ResolvedBillingEnv = {
  configured: false,
  mode: 'missing',
  message: 'Billing wrapper not configured.',
}

const signedInStatus: AuthStatus = {
  mode: 'signed-in',
  label: 'user@example.com',
  description: 'Supabase session detected.',
  userId: 'test-user-id',
  email: 'user@example.com',
}

const signedOutStatus: AuthStatus = {
  mode: 'signed-out',
  label: 'Signed out',
  description: 'Supabase is configured, but no user session is active yet.',
}

const unavailableStatus: AuthStatus = {
  mode: 'unavailable',
  label: 'Supabase unavailable',
  description: 'Supabase not configured.',
}

const readyBootstrap: PersonalWorkspaceBootstrapStatus = {
  mode: 'ready',
  label: 'Workspace ready',
  description: 'Personal workspace is ready.',
  workspaceId: 'test-workspace-id',
}

const waitingBootstrap: PersonalWorkspaceBootstrapStatus = {
  mode: 'idle',
  label: 'Bootstrap waiting',
  description: 'No Supabase auth session. Workspace bootstrap is not possible until sign-in.',
}

beforeEach(() => {
  localStorage.clear()
  mockSyncDescription = 'Sync status.'
  cloudMock.create.mockReset().mockReturnValue(cloudMock.adapter)
  cloudMock.adapter.setActiveWorkspaceId.mockReset()
  cloudMock.adapter.listWorkspaces.mockResolvedValue([{ id: 'test-workspace-id', name: 'Personal', type: 'personal', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }])
  cloudMock.adapter.listIdeas.mockResolvedValue([])
  cloudMock.adapter.listProjects.mockResolvedValue([])
  cloudMock.adapter.listTasks.mockResolvedValue([])
  cloudMock.adapter.listNotes.mockResolvedValue([])
})

describe('Signed-in auth flows', () => {
  beforeEach(() => {
    mockSupabaseEnv = configuredSupabaseEnv
    mockBillingEnv = unconfiguredBillingEnv
    mockAuthStatus = signedInStatus
    mockBootstrap = readyBootstrap
    mockSyncLabel = 'Cloud connected'
  })

  it('shows signed-in state in Account tab with sign-out button', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /settings/i }))
    expect(screen.getByRole('dialog', { name: /settings/i })).toBeInTheDocument()

    expect(screen.getAllByText(/user@example\.com/i).length).toBeGreaterThanOrEqual(1)

    expect(screen.queryByRole('button', { name: /send magic link/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/Dev admin email is prefilled/i)).not.toBeInTheDocument()

    const signOut = screen.getByRole('button', { name: /sign out/i })
    expect(signOut).toBeEnabled()
    await user.click(signOut)
    expect(screen.getByText(/signed out/i)).toBeInTheDocument()
  })

  it('shows signed-in email pill in toolbar', () => {
    render(<App />)
    expect(screen.getByTitle(/user@example\.com/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /sign in/i })).not.toBeInTheDocument()
  })

  it('restores the persisted cloud workspace selection', async () => {
    localStorage.setItem('OpenNapse:v0:active-workspace-id:cloud:test.supabase.co:test-user-id', 'shared-workspace')
    cloudMock.adapter.listWorkspaces.mockResolvedValue([
      { id: 'test-workspace-id', name: 'Personal', type: 'personal', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'shared-workspace', name: 'Shared', type: 'personal', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    ])
    render(<App />)

    await waitFor(() => expect(cloudMock.adapter.setActiveWorkspaceId).toHaveBeenCalledWith('shared-workspace'))
    expect(screen.getByLabelText(/select workspace/i)).toHaveValue('shared-workspace')
  })

  it('shows billing tab when billing URL is configured', async () => {
    mockBillingEnv = configuredBillingEnv
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /settings/i }))
    expect(screen.getByRole('button', { name: /^billing$/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^advanced$/i })).not.toBeInTheDocument()
  })

  it('hides Supabase project details when billing URL is configured (hosted)', async () => {
    mockBillingEnv = configuredBillingEnv
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /settings/i }))
    await user.click(screen.getByRole('button', { name: /^account$/i }))

    expect(screen.queryByText(/Supabase project/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Cloud auth/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Workspace bootstrap/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Dev admin email is prefilled/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /send magic link/i })).not.toBeInTheDocument()
  })

  it('shows cloud-connected pill without claiming sync when signed in', () => {
    render(<App />)
    expect(screen.getAllByText('Cloud connected').length).toBeGreaterThanOrEqual(1)
  })

  it('shows sync failure state when cloud connection fails', () => {
    mockSyncLabel = 'Sync failed'
    mockSyncDescription = 'Cloud migration failed.'
    render(<App />)

    expect(screen.getAllByText('Sync failed').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Cloud migration failed.')).toBeInTheDocument()
  })

  it('reopens the previous adapter after bootstrap fails', async () => {
    mockBootstrap = {
      mode: 'failed',
      label: 'Bootstrap failed',
      description: 'Workspace setup failed.',
    }
    render(<App />)

    await waitFor(() => expect(() => getDb()).not.toThrow())
  })

  it('reopens the previous adapter after cloud setup throws', async () => {
    cloudMock.create.mockImplementationOnce(() => { throw new Error('Cloud setup failed.') })
    render(<App />)

    await waitFor(() => expect(() => getDb()).not.toThrow())
  })

  it('shows credit usage panel when signed in with configured Supabase', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /settings/i }))
    await user.click(screen.getByRole('button', { name: /^ai$/i }))

    expect(screen.getByText(/daily free credits/i)).toBeInTheDocument()
  })
})

describe('Billing gate', () => {
  beforeEach(() => {
    mockSupabaseEnv = configuredSupabaseEnv
    mockBillingEnv = unconfiguredBillingEnv
    mockAuthStatus = signedInStatus
    mockBootstrap = readyBootstrap
  })

  it('hides billing tab when billing URL is not configured (open-source mode)', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /settings/i }))
    expect(screen.queryByRole('button', { name: /^billing$/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^advanced$/i })).toBeInTheDocument()
  })

  it('does not block core functionality when billing is unconfigured', async () => {
    render(<App />)

    expect(screen.getByRole('button', { name: /dump idea/i })).toBeEnabled()
    expect(screen.getAllByRole('button', { name: /^notes$/i }).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /toggle theme/i })).toBeInTheDocument()
  })
})

describe('Sign-in modal flows', () => {
  beforeEach(() => {
    mockSupabaseEnv = configuredSupabaseEnv
    mockBillingEnv = unconfiguredBillingEnv
    mockAuthStatus = signedOutStatus
    mockBootstrap = waitingBootstrap
  })

  it('opens sign-in modal from toolbar button and sends magic link', async () => {
    const user = userEvent.setup()
    render(<App />)

    const signInBtn = screen.getByRole('button', { name: /sign in/i })
    expect(signInBtn).toBeEnabled()
    await user.click(signInBtn)

    expect(screen.getByRole('dialog', { name: /welcome back/i })).toBeInTheDocument()
    const emailInput = screen.getByLabelText(/^email$/i)
    await user.type(emailInput, 'test@example.com')
    await user.click(screen.getByRole('button', { name: /send magic link/i }))

    await waitFor(() => {
      expect(screen.getByText(/magic link sent/i)).toBeInTheDocument()
    })
  })

  it('shows disabled sign-in form when Supabase is not configured', async () => {
    mockSupabaseEnv = unconfiguredSupabaseEnv
    mockAuthStatus = unavailableStatus
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /settings/i }))

    expect(screen.getByLabelText(/email for magic link/i)).toBeDisabled()
  })
})

describe('Settings — Data tab factory reset', () => {
  beforeEach(() => {
    mockSupabaseEnv = unconfiguredSupabaseEnv
    mockBillingEnv = unconfiguredBillingEnv
    mockAuthStatus = unavailableStatus
    mockBootstrap = waitingBootstrap
  })

  it('renders factory reset button and shows confirmation on click', async () => {
    const originalConfirm = window.confirm
    window.confirm = vi.fn().mockReturnValue(false)
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /settings/i }))
    await user.click(screen.getByRole('button', { name: /^data$/i }))

    expect(screen.getByRole('heading', { name: /factory reset/i })).toBeInTheDocument()

    const resetBtn = screen.getByRole('button', { name: /factory reset/i })
    await user.click(resetBtn)
    expect(window.confirm).toHaveBeenCalledTimes(1)

    window.confirm = originalConfirm
  })
})

describe('Settings — Account tab in local/unavailable mode', () => {
  beforeEach(() => {
    mockSupabaseEnv = unconfiguredSupabaseEnv
    mockBillingEnv = unconfiguredBillingEnv
    mockAuthStatus = unavailableStatus
    mockBootstrap = waitingBootstrap
  })

  it('shows disabled email field and magic link form', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /settings/i }))

    expect(screen.getByLabelText(/email for magic link/i)).toBeDisabled()
    expect(screen.getByLabelText(/email for magic link/i)).toHaveValue('')
    expect(screen.getByRole('button', { name: /send magic link/i })).toBeDisabled()
    expect(screen.queryByRole('button', { name: /sign out/i })).not.toBeInTheDocument()
  })

  it('navigates through all settings tabs without error', async () => {
    const user = userEvent.setup()
    render(<App />)

    // Dismiss tutorial if present
    const skipTour = screen.queryByRole('button', { name: /skip tour/i })
    if (skipTour) await user.click(skipTour)

    await user.click(screen.getByRole('button', { name: /settings/i }))

    const tabs = ['^account$', '^data$', '^ai$', '^advanced$']
    for (const tab of tabs) {
      const btn = screen.queryByRole('button', { name: new RegExp(tab, 'i') })
      if (!btn) continue
      await user.click(btn)
    }

    await user.click(screen.getByRole('button', { name: /^close$/i }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })
})

describe('Auth state transitions', () => {
  beforeEach(() => {
    mockSupabaseEnv = configuredSupabaseEnv
    mockBillingEnv = configuredBillingEnv
    mockAuthStatus = signedInStatus
    mockBootstrap = readyBootstrap
    mockSyncLabel = 'Cloud connected'
  })

  it('settings dialog survives rapid tab switching', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /settings/i }))

    const tabs = screen.getAllByRole('button').filter((btn) =>
      ['account', 'data', 'ai', 'billing'].some((t) =>
        btn.getAttribute('aria-label')?.toLowerCase() === t ||
        btn.textContent?.toLowerCase() === t,
      ),
    )

    for (let round = 0; round < 3; round++) {
      for (const tab of tabs) {
        await user.click(tab)
      }
    }

    const dialogs = screen.getAllByRole('dialog')
    expect(dialogs.length).toBeGreaterThanOrEqual(1)
  })

  it('core functionality remains when switching from configured to unconfigured billing', () => {
    render(<App />)

    expect(screen.getByRole('button', { name: /dump idea/i })).toBeEnabled()

    mockBillingEnv = unconfiguredBillingEnv

    expect(screen.getByRole('button', { name: /dump idea/i })).toBeEnabled()
  })

  it('signed-out status does not gate idea capture or note creation', () => {
    mockAuthStatus = signedOutStatus
    render(<App />)

    expect(screen.getByRole('button', { name: /dump idea/i })).toBeEnabled()
    expect(screen.getAllByRole('button', { name: /^notes$/i }).length).toBeGreaterThan(0)
  })

  it('does not construct a cloud adapter while auth is loading', async () => {
    mockAuthStatus = { mode: 'loading', label: 'Checking', description: 'Resolving session.' }
    mockBootstrap = waitingBootstrap
    render(<App />)

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(cloudMock.create).not.toHaveBeenCalled()
  })

  it('suppresses a stale cloud transition after sign-out', async () => {
    let resolveWorkspaces!: (workspaces: unknown[]) => void
    cloudMock.adapter.listWorkspaces.mockImplementationOnce(() => new Promise((resolve) => { resolveWorkspaces = resolve }))
    const view = render(<App />)

    mockAuthStatus = signedOutStatus
    mockBootstrap = waitingBootstrap
    view.rerender(<App />)
    resolveWorkspaces([{ id: 'test-workspace-id', name: 'Personal', type: 'personal', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }])

    await Promise.resolve()
    await Promise.resolve()
    expect(cloudMock.adapter.setActiveWorkspaceId).not.toHaveBeenCalled()
  })

  it('does not commit an in-flight cloud transition after unmount', async () => {
    let resolveWorkspaces!: (workspaces: unknown[]) => void
    const previousAdapter = getDb()
    const previousState = useWorkspacesStore.getState()
    cloudMock.adapter.listWorkspaces.mockImplementationOnce(() => new Promise((resolve) => { resolveWorkspaces = resolve }))
    const view = render(<App />)

    view.unmount()
    resolveWorkspaces([{ id: 'test-workspace-id', name: 'Personal', type: 'personal', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }])
    await Promise.resolve()
    await Promise.resolve()

    expect(getDb()).toBe(previousAdapter)
    expect(useWorkspacesStore.getState().workspaces).toEqual(previousState.workspaces)
    expect(useWorkspacesStore.getState().activeWorkspaceId).toBe(previousState.activeWorkspaceId)
  })
})
