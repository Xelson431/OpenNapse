import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent as ReactDragEvent, type FormEvent, type PointerEvent as ReactPointerEvent, type Ref } from 'react'
import './App.css'
import { DAILY_FREE_AI_CREDITS } from './ai/action-costs'
import { AI_PROVIDERS, AI_SETTINGS_STORAGE_KEY, buildOllamaCloudPreview, buildProviderPreview, canRunHostedAI, loadAISettings, serializeAISettings, type AIRequestPreview, type AISettings } from './ai/provider'
import { testProviderConnection, listProviderModels, type ListedModel } from './ai/test-connection'
import dummyData from './assets/dummy-data.json'
import { requestMagicLink, signOutOfSupabase, useAuthStatus, type AuthStatus } from './auth/use-auth-status'
import { usePersonalWorkspaceBootstrap, type PersonalWorkspaceBootstrapStatus } from './auth/use-personal-workspace-bootstrap'
import { logger, getLogs, clearLogs, serializeLogs, subscribeLogs, type LogEntry, type LogLevel } from './lib/logger'
import { acceptInvite, inviteWorkspaceMember, listWorkspaceInvites, listWorkspaceMembers, revokeWorkspaceInvite, removeWorkspaceMember, type InviteRole, type WorkspaceInvite, type WorkspaceMember } from './auth/teams'
import { getTodayBalance, listRecentUsage, type DailyCreditBalance, type UsageEvent } from './auth/credits'
import { createBillingPortalSession, createCheckoutSession, useSubscriptionStatus } from './auth/billing'
import { listAuditLog, type AuditEntry } from './auth/audit'
import { Icon, type IconName } from './components/Icon'
import { PricingModal } from './components/PricingModal'
import { fetchProfile, updateDisplayName } from './auth/profile'
import { getBillingEnv, getSupabaseEnv, type ResolvedSupabaseEnv } from './config/env'
import { enhanceIdeaTitle, generateLocalAISuggestions } from './domain/ai'
import { generateMentorReply, type MentorContext } from './domain/mentor'
import type { FeatureDefinition } from './domain/features'
import { getIdeaTemperature, type Idea } from './domain/ideas'
import { MAX_VOICE_RECORDING_DATA_URL_LENGTH, type Note, type VoiceRecording } from './domain/notes'
import type { Project } from './domain/projects'
import { calculateStats } from './domain/stats'
import { taskColumns, type CreateTaskInput, type Task, type TaskColumn, type UpdateTaskInput } from './domain/tasks'
import { LOCAL_PERSONAL_WORKSPACE_ID, createActiveWorkspace, createActiveWorkspaceFromRecord, workspaceModes, type ActiveWorkspace, type WorkspaceMode } from './domain/workspaces'
import { IDEA_DRAG_MIME, hasIdeaDragPayload, readIdeaDragPayload } from './lib/drag'
import { useSyncStatus } from './sync/use-sync'
import { useIdeasStore } from './stores/use-ideas-store'
import { toPromoteInput, useWorkspaceStore } from './stores/use-workspace-store'
import { useWorkspacesStore } from './stores/use-workspaces-store'
import { getDb, setDb } from './db/get-db'
import { createSupabaseCloudAdapter } from './db/supabase-cloud-adapter'
import { BrowserLocalAdapter } from './db/browser-local-adapter'

type ViewId = 'capture' | 'dashboard' | 'kanban' | 'notes' | 'graph' | 'focus' | 'stats' | 'logs'
type ThemeMode = 'light' | 'dark'
type MentorRole = 'user' | 'assistant' | 'system' | 'action'
type MentorSession = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messages: { id: string; role: MentorRole; content: string; createdAt: string }[]
}
type LocalCloudMigrationPrompt = {
  payload: string
  counts: { ideas: number; projects: number; tasks: number; notes: number }
}
type SidebarFilter =
  | { kind: 'all' }
  | { kind: 'project'; projectId: string }
  | { kind: 'tag'; tag: string }

type GraphNodeKind = 'Idea' | 'Project' | 'Task' | 'Note'
type GraphNode = {
  id: string
  label: string
  kind: GraphNodeKind
  detail: string
  lane: number
  order: number
  x: number
  y: number
  accent: string
  anchorId?: string | null
}
type GraphPoint = { x: number; y: number }
type GraphEdge = {
  id: string
  from: string
  to: string
  label: string
}
function clampGraphPoint(value: number) {
  return Math.max(4, Math.min(96, value))
}

const THEME_STORAGE_KEY = 'OpenNapse:v0:theme'
const MENTOR_STORAGE_KEY = 'OpenNapse:v0:mentor-sessions'
const SIDEBAR_COLLAPSED_STORAGE_KEY = 'OpenNapse:v0:sidebar-collapsed'
const CLOUD_MIGRATION_DISMISSED_STORAGE_KEY = 'OpenNapse:v0:cloud-migration-dismissed'
const ACTIVE_VIEW_STORAGE_KEY = 'OpenNapse:v0:active-view'
const MOBILE_MEDIA_QUERY = '(max-width: 640px)'
const ENABLE_TEAM_WORKSPACES = import.meta.env.VITE_ENABLE_TEAM_WORKSPACES === 'true'

function countExportPayload(payload: string): LocalCloudMigrationPrompt['counts'] {
  try {
    const parsed = JSON.parse(payload) as { ideas?: unknown[]; projects?: unknown[]; tasks?: unknown[]; notes?: unknown[] }
    return {
      ideas: Array.isArray(parsed.ideas) ? parsed.ideas.length : 0,
      projects: Array.isArray(parsed.projects) ? parsed.projects.length : 0,
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks.length : 0,
      notes: Array.isArray(parsed.notes) ? parsed.notes.length : 0,
    }
  } catch {
    return { ideas: 0, projects: 0, tasks: 0, notes: 0 }
  }
}

function hasExportedContent(counts: LocalCloudMigrationPrompt['counts']): boolean {
  return counts.ideas + counts.projects + counts.tasks + counts.notes > 0
}

function isMobileViewport(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia(MOBILE_MEDIA_QUERY).matches
}

function getInitialSidebarCollapsed(): boolean {
  if (typeof window === 'undefined') return false
  if (isMobileViewport()) return true
  try {
    const stored = localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY)
    if (stored === 'true') return true
    if (stored === 'false') return false
  } catch {
    // ignore storage read failures
  }
  return false
}
// Product gates for surfaces that are built but intentionally kept hidden from the shipped UI.
// Flipping these to `true` re-exposes the legacy Mentor panel / local AI suggestions strip.
// Tests in App.test.tsx ('hides Suggestions and Mentor surfaces') lock in the default off state.
const SHOW_LOCAL_AI_SUGGESTIONS = false
const SHOW_MENTOR_PANEL = false
const views: Array<{ id: ViewId; label: string; icon: IconName; status: FeatureDefinition['status'] }> = [
  { id: 'capture', label: 'Capture', icon: 'lightbulb', status: 'live' },
  { id: 'dashboard', label: 'Dashboard', icon: 'folder', status: 'live' },
  { id: 'kanban', label: 'Kanban', icon: 'columns', status: 'live' },
  { id: 'notes', label: 'Notes', icon: 'fileText', status: 'live' },
  { id: 'graph', label: 'Graph', icon: 'network', status: 'live' },
  { id: 'focus', label: 'Focus', icon: 'target', status: 'live' },
  { id: 'stats', label: 'Stats', icon: 'barChart', status: 'live' },
  { id: 'logs', label: 'Logs', icon: 'search', status: 'live' },
]

function App() {
  const [activeView, setActiveView] = useState<ViewId>(() => {
    const stored = typeof window !== 'undefined' ? localStorage.getItem(ACTIVE_VIEW_STORAGE_KEY) : null
    const valid: ViewId[] = ['capture', 'dashboard', 'kanban', 'notes', 'graph', 'focus', 'stats', 'logs']
    return stored && valid.includes(stored as ViewId) ? (stored as ViewId) : 'capture'
  })
  const [sidebarTab, setSidebarTab] = useState<'folders' | 'tags'>('folders')
  const [sidebarFilter, setSidebarFilter] = useState<SidebarFilter>({ kind: 'all' })
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(getInitialSidebarCollapsed)
  const [flowMode, setFlowMode] = useState(false)
  const [theme, setTheme] = useState<ThemeMode>(() => {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    return stored === 'dark' ? 'dark' : 'light'
  })
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('personal')
  const { workspaces, activeWorkspaceId, loadWorkspaces, setActiveWorkspace, createWorkspace: createWorkspaceRecord } = useWorkspacesStore()

  const [isCaptureOpen, setIsCaptureOpen] = useState(false)
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isSignInOpen, setIsSignInOpen] = useState(false)
  const [isCreateWorkspaceOpen, setIsCreateWorkspaceOpen] = useState(false)
  const [isMentorOpen, setIsMentorOpen] = useState(() => !isMobileViewport())
  const [isStatusDockOpen, setIsStatusDockOpen] = useState(false)
  const [promotingIdea, setPromotingIdea] = useState<Idea | null>(null)
  const [creatingProject, setCreatingProject] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const deferredSearchQuery = useDeferredValue(searchQuery)
  const [aiSettings, setAISettings] = useState<AISettings>(() => loadAISettings())
  const [sessionKeys, setSessionKeys] = useState<Record<string, string>>({})
  const [acceptedPreviewHash, setAcceptedPreviewHash] = useState<string | undefined>()
  const [settingsSavedAt, setSettingsSavedAt] = useState<string | null>(null)
  const [cloudMigrationPrompt, setCloudMigrationPrompt] = useState<LocalCloudMigrationPrompt | null>(null)
  const [cloudMigrationMessage, setCloudMigrationMessage] = useState('')
  const { ideas, isLoaded, loadIdeas, createIdea, buryIdea, resurrectIdea, moveIdeaToProject, clearAllData: clearIdeas } = useIdeasStore()
  const { projects, tasks, notes, loadWorkspace, createProject, promoteIdea, createTask, moveTask, updateTask, upsertNote, exportData, importData, clearAllData: clearWorkspace } = useWorkspaceStore()
  const supabaseEnv = useMemo(() => getSupabaseEnv(), [])
  const authStatus = useAuthStatus()
  const workspaceBootstrap = usePersonalWorkspaceBootstrap(authStatus)
  const activeWorkspaceRecord = useMemo(
    () => workspaces.find((w) => w.id === activeWorkspaceId),
    [workspaces, activeWorkspaceId],
  )
  const visibleWorkspaces = useMemo(
    () => (ENABLE_TEAM_WORKSPACES ? workspaces : workspaces.filter((workspace) => workspace.type !== 'team')),
    [workspaces],
  )
  const activeWorkspace = useMemo<ActiveWorkspace>(
    () => (activeWorkspaceRecord ? createActiveWorkspaceFromRecord(activeWorkspaceRecord) : createActiveWorkspace(workspaceMode)),
    [activeWorkspaceRecord, workspaceMode],
  )
  const sync = useSyncStatus(authStatus, workspaceBootstrap)

  const [mentorSessions, setMentorSessions] = useState<MentorSession[]>(() => {
    const raw = localStorage.getItem(MENTOR_STORAGE_KEY)
    if (!raw) return []
    try {
      return JSON.parse(raw) as MentorSession[]
    } catch {
      return []
    }
  })
  const [activeMentorId, setActiveMentorId] = useState<string | null>(null)

  const sidebarRef = useRef<HTMLElement | null>(null)
  const sidebarToggleRef = useRef<HTMLButtonElement | null>(null)
  const previousSidebarCollapsedRef = useRef<boolean>(sidebarCollapsed)

  useEffect(() => {
    void loadWorkspaces()
  }, [loadWorkspaces])

  useEffect(() => {
    // activeWorkspaceId is reactive; reload content whenever the user swaps workspaces.
    void loadIdeas()
    void loadWorkspace()
  }, [activeWorkspaceId, loadIdeas, loadWorkspace])

  useEffect(() => {
    if (ENABLE_TEAM_WORKSPACES) return
    if (activeWorkspaceRecord?.type !== 'team') return
    setActiveWorkspace(LOCAL_PERSONAL_WORKSPACE_ID)
  }, [activeWorkspaceRecord, setActiveWorkspace])

  const activeUserIdRef = useRef<string | null>(null)
  const [didAutoMigrate, setDidAutoMigrate] = useState(false)
  useEffect(() => {
    logger.info('adapter', `Auth status: ${authStatus.mode}, Bootstrap: ${workspaceBootstrap.mode}`)
    void (async () => {
      if (authStatus.mode === 'signed-in' && authStatus.userId && workspaceBootstrap?.mode === 'ready' && workspaceBootstrap.workspaceId) {
        logger.info('adapter', 'Switching to SupabaseCloudAdapter', { workspaceId: workspaceBootstrap.workspaceId })
        if (!didAutoMigrate && activeUserIdRef.current !== authStatus.userId) {
          activeUserIdRef.current = authStatus.userId
          const localAdapter = new BrowserLocalAdapter()
          localAdapter.setActiveWorkspaceId(activeWorkspaceId)
          const [localPayload, cloudIdeas, cloudProjects, cloudTasks, cloudNotes] = await Promise.all([
            localAdapter.exportData(),
            getDb().listIdeas(),
            getDb().listProjects(),
            getDb().listTasks(),
            getDb().listNotes(),
          ])
          const localCounts = countExportPayload(localPayload)
          const cloudEmpty = cloudIdeas.length + cloudProjects.length + cloudTasks.length + cloudNotes.length === 0
          if (cloudEmpty && hasExportedContent(localCounts)) {
            await getDb().importData(localPayload)
          }
          setDidAutoMigrate(true)
        }

        setDb(createSupabaseCloudAdapter())
        setActiveWorkspace(workspaceBootstrap.workspaceId)
        await loadWorkspaces()
        await loadIdeas()
        await loadWorkspace()
        return
      }
      if (authStatus.mode === 'signed-out' || authStatus.mode === 'unavailable') {
        logger.info('adapter', 'Switching to BrowserLocalAdapter', { mode: authStatus.mode })
        activeUserIdRef.current = null
        setDidAutoMigrate(false)
        setDb(new BrowserLocalAdapter())
        await loadWorkspaces()
        await loadIdeas()
        await loadWorkspace()
      }
    })()
  }, [authStatus, workspaceBootstrap, activeWorkspaceId, loadIdeas, loadWorkspace, loadWorkspaces, didAutoMigrate])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem(THEME_STORAGE_KEY, theme)
  }, [theme])

  useEffect(() => {
    localStorage.setItem(AI_SETTINGS_STORAGE_KEY, serializeAISettings(aiSettings))
  }, [aiSettings])

  useEffect(() => {
    localStorage.setItem(ACTIVE_VIEW_STORAGE_KEY, activeView)
  }, [activeView])

  useEffect(() => {
    localStorage.setItem(MENTOR_STORAGE_KEY, JSON.stringify(mentorSessions))
  }, [mentorSessions])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const isTyping = target?.closest('input, textarea, select, button, [contenteditable="true"]')
      if (event.code === 'Space' && !isTyping) {
        event.preventDefault()
        setIsCaptureOpen(true)
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setIsCommandPaletteOpen(true)
      }
      if (event.key === 'Escape') {
        setIsCaptureOpen(false)
        setIsCommandPaletteOpen(false)
        if (isMobileViewport()) {
          setSidebarCollapsed(true)
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Sync sidebar collapse state with viewport: force-collapse when entering mobile,
  // restore the persisted desktop preference when leaving mobile.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia(MOBILE_MEDIA_QUERY)
    const handleChange = (event: MediaQueryListEvent) => {
      if (event.matches) {
        setSidebarCollapsed(true)
        return
      }
      try {
        const stored = localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY)
        setSidebarCollapsed(stored === 'true')
      } catch {
        setSidebarCollapsed(false)
      }
    }
    mql.addEventListener('change', handleChange)
    return () => mql.removeEventListener('change', handleChange)
  }, [])

  // Persist sidebar preference only on desktop; mobile state is always collapsed by default.
  useEffect(() => {
    if (isMobileViewport()) return
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(sidebarCollapsed))
    } catch {
      // ignore storage write failures
    }
  }, [sidebarCollapsed])

  // Click-outside to dismiss the mobile sidebar overlay.
  useEffect(() => {
    if (sidebarCollapsed) return
    if (!isMobileViewport()) return
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (sidebarRef.current?.contains(target)) return
      if (sidebarToggleRef.current?.contains(target)) return
      setSidebarCollapsed(true)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [sidebarCollapsed])

  // Focus management: move focus into sidebar when it opens on mobile,
  // and restore focus to the toggle when it closes.
  useEffect(() => {
    const wasCollapsed = previousSidebarCollapsedRef.current
    previousSidebarCollapsedRef.current = sidebarCollapsed
    if (!isMobileViewport()) return
    if (wasCollapsed && !sidebarCollapsed) {
      const focusables = sidebarRef.current?.querySelectorAll<HTMLElement>(
        'a, button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )
      focusables?.[0]?.focus()
    } else if (!wasCollapsed && sidebarCollapsed) {
      sidebarToggleRef.current?.focus()
    }
  }, [sidebarCollapsed])

  useEffect(() => {
    if (!ENABLE_TEAM_WORKSPACES) return
    if (authStatus.mode !== 'signed-in') return
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const token = params.get('invite')
    if (!token) return
    void (async () => {
      const result = await acceptInvite(token)
      if (result.ok) {
        await loadWorkspaces()
        setActiveWorkspace(result.data.workspaceId)
      }
      params.delete('invite')
      const next = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}${window.location.hash}`
      window.history.replaceState(null, '', next)
    })()
  }, [authStatus.mode, loadWorkspaces, setActiveWorkspace])

  const buriedIdeas = useMemo(() => ideas.filter((idea) => idea.status === 'buried'), [ideas])
  const activeIdeas = useMemo(() => ideas.filter((idea) => idea.status !== 'buried'), [ideas])
  const sidebarTags = useMemo(() => {
    const counts = new Map<string, number>()
    for (const idea of activeIdeas) {
      for (const tag of idea.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
    }
    return Array.from(counts.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([tag, count]) => ({ tag, count }))
  }, [activeIdeas])
  const visibleIdeas = useMemo(() => {
    const query = deferredSearchQuery.toLowerCase().trim()
    return activeIdeas.filter((idea) => {
      const matchesQuery = !query || `${idea.title} ${idea.body} ${idea.tags.join(' ')}`.toLowerCase().includes(query)
      const matchesTag = sidebarFilter.kind !== 'tag' || idea.tags.includes(sidebarFilter.tag)
      const matchesProject = sidebarFilter.kind !== 'project' || idea.projectId === sidebarFilter.projectId
      return matchesQuery && matchesTag && matchesProject
    })
  }, [activeIdeas, deferredSearchQuery, sidebarFilter])
  const selectedProjectId = sidebarFilter.kind === 'project' ? sidebarFilter.projectId : undefined
  const captureDestinationName = selectedProjectId ? projects.find((project) => project.id === selectedProjectId)?.title ?? 'this project' : 'General Knowledge'
  const hotIdeasCount = useMemo(() => activeIdeas.filter(i => getIdeaTemperature(i.lastTouchedAt) === 'hot').length, [activeIdeas])

  function handleSidebarFilter(filter: SidebarFilter) {
    const isSameProject =
      filter.kind === 'project' &&
      sidebarFilter.kind === 'project' &&
      sidebarFilter.projectId === filter.projectId
    const isSameTag =
      filter.kind === 'tag' &&
      sidebarFilter.kind === 'tag' &&
      sidebarFilter.tag === filter.tag
    setSidebarFilter(isSameProject || isSameTag ? { kind: 'all' } : filter)
    if (isMobileViewport()) {
      setSidebarCollapsed(true)
    }
  }

  async function handleMoveIdeaToProject(ideaId: string, projectId: string) {
    const idea = ideas.find((item) => item.id === ideaId)
    if (!idea || idea.projectId === projectId) return
    await moveIdeaToProject(ideaId, projectId)
    setSidebarFilter({ kind: 'project', projectId })
  }

  function updateAISettings(next: AISettings) {
    setAISettings(next)
    setAcceptedPreviewHash(undefined)
    setSettingsSavedAt(new Date().toISOString())
  }

  function ensureMentorSession(): MentorSession {
    const existing = mentorSessions.find((session) => session.id === activeMentorId)
    if (existing) return existing
    const now = new Date().toISOString()
    const newSession: MentorSession = {
      id: crypto.randomUUID(),
      title: 'Mentor session',
      createdAt: now,
      updatedAt: now,
      messages: [
        { id: crypto.randomUUID(), role: 'assistant', content: 'I am Mentor. I can help you structure ideas, plan projects, and surface risks. Ask me anything about your workspace.', createdAt: now },
      ],
    }
    setMentorSessions((current) => [newSession, ...current])
    setActiveMentorId(newSession.id)
    return newSession
  }

  function appendMentorMessage(sessionId: string, role: MentorRole, content: string) {
    setMentorSessions((current) => current.map((session) => session.id === sessionId
      ? {
          ...session,
          updatedAt: new Date().toISOString(),
          messages: [...session.messages, { id: crypto.randomUUID(), role, content, createdAt: new Date().toISOString() }],
        }
      : session))
  }

  function buildMentorContext(): MentorContext {
    const ideasByProject = ideas.reduce<Record<string, Idea[]>>((acc, idea) => {
      if (!idea.projectId) return acc
      acc[idea.projectId] = acc[idea.projectId] ? [...acc[idea.projectId], idea] : [idea]
      return acc
    }, {})
    return { ideas, projects, tasks, notes, ideasByProject }
  }

  function handleMentorSend(message: string) {
    const session = ensureMentorSession()
    appendMentorMessage(session.id, 'user', message)
    const context = buildMentorContext()
    const reply = generateMentorReply(message, context)
    appendMentorMessage(session.id, 'assistant', reply)
  }

  const shellClass = `app-shell${sidebarCollapsed ? ' sidebar-collapsed' : ''}${flowMode ? ' flow-mode' : ''}`

  return (
    <main className="app-canvas">
      <div className={shellClass}>
        <NavRail
          activeTab={activeView}
          onTabChange={setActiveView}
          ideaCount={hotIdeasCount}
          theme={theme}
          onToggleTheme={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')}
          onOpenSettings={() => setIsSettingsOpen(true)}
        />
        
        <Sidebar
          sidebarTab={sidebarTab}
          onSidebarTabChange={setSidebarTab}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          projectsCount={projects.length}
          projects={projects}
          ideas={activeIdeas}
          tags={sidebarTags}
          activeFilter={sidebarFilter}
          onSelectFilter={handleSidebarFilter}
          onMoveIdeaToProject={handleMoveIdeaToProject}
          ideaDropEnabled={!sidebarCollapsed && !flowMode}
          rootRef={sidebarRef}
        />

        <main className="main-content" role="main">
          <div className="workspace-toolbar" aria-label="Workspace and view controls">
            <div className="workspace-switcher" aria-label="Active workspace">
              <span className="workspace-kicker">Workspace</span>
              <select
                className="workspace-select"
                aria-label="Select workspace"
                value={activeWorkspaceId}
                onChange={(event) => {
                  const value = event.target.value
                  if (value === '__create__') {
                    setIsCreateWorkspaceOpen(true)
                    // Force select back to current workspace so it doesn't stick on "__create__"
                    event.target.value = activeWorkspaceId
                    return
                  }
                  setActiveWorkspace(value)
                }}
              >
                {visibleWorkspaces.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    {workspace.name}
                    {workspace.type === 'team' ? ' · team' : ''}
                  </option>
                ))}
                <option value="__create__">＋ Create workspace…</option>
              </select>
              <small className="workspace-select-badge">{authStatus.mode === 'signed-in' && workspaceBootstrap?.mode === 'ready' ? 'Cloud' : activeWorkspace.badge}</small>
            </div>
            <span className="sync-status-pill" title={sync.description}>
               {sync.label}
            </span>
            {supabaseEnv.configured ? (
              authStatus.mode === 'signed-in' ? (
                <button
                  type="button"
                  className="sync-status-pill auth-pill"
                  title={`Signed in as ${authStatus.email ?? 'Supabase user'}. ${workspaceBootstrap.description}`}
                  onClick={() => setIsSettingsOpen(true)}
                >
                  {authStatus.email ?? 'Signed in'}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-secondary btn-compact"
                  onClick={() => setIsSignInOpen(true)}
                  disabled={authStatus.mode === 'loading'}
                >
                  {authStatus.mode === 'loading' ? 'Checking…' : 'Sign in'}
                </button>
              )
            ) : null}
            <button
              ref={sidebarToggleRef}
              className="btn btn-ghost"
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              title={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
              aria-label={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
              aria-expanded={!sidebarCollapsed}
              aria-controls="app-sidebar"
            >
              <Icon name="sidebar" />
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => setFlowMode(!flowMode)}
              title={flowMode ? 'Exit flow mode' : 'Enter flow mode'}
              aria-label={flowMode ? 'Exit flow mode' : 'Enter flow mode'}
              aria-pressed={flowMode}
            >
              <Icon name="target" />
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => setIsStatusDockOpen((open) => !open)}
              title={isStatusDockOpen ? 'Hide status' : 'Show status'}
              aria-label={isStatusDockOpen ? 'Hide status dock' : 'Show status dock'}
              aria-pressed={isStatusDockOpen}
            >
              <Icon name="barChart" />
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => setIsCommandPaletteOpen(true)}
              title="Command palette (⌘K)"
              aria-label="Open command palette"
            >
              <Icon name="search" />
            </button>
            {SHOW_MENTOR_PANEL ? (
              <button
                className="btn btn-ghost"
                onClick={() => setIsMentorOpen((open) => !open)}
                title={isMentorOpen ? 'Hide Mentor' : 'Show Mentor'}
                aria-label={isMentorOpen ? 'Hide Mentor assistant' : 'Show Mentor assistant'}
                aria-pressed={isMentorOpen}
              >
                <Icon name="bot" />
              </button>
            ) : null}
          </div>

          {activeView === 'capture' && (
            <CaptureView
              ideas={visibleIdeas}
              buriedIdeas={buriedIdeas}
              isLoaded={isLoaded}
              onBury={buryIdea}
              onResurrect={resurrectIdea}
              onPromote={setPromotingIdea}
              onCapture={() => setIsCaptureOpen(true)}
            />
          )}
          {activeView === 'dashboard' && (
            <DashboardView
              projects={projects}
              ideas={activeIdeas}
              tasks={tasks}
              selectedProjectId={selectedProjectId}
              canDragIdeas={!sidebarCollapsed && !flowMode}
              onCapture={() => setIsCaptureOpen(true)}
              onCreateProject={() => setCreatingProject(true)}
              onOpenProject={(projectId) => {
                setSidebarFilter({ kind: 'project', projectId })
                setActiveView('dashboard')
              }}
            />
          )}
          {activeView === 'kanban' && (
            <KanbanView projects={projects} tasks={tasks} activeProjectId={selectedProjectId} onMoveTask={moveTask} onCreateTask={createTask} onUpdateTask={updateTask} />
          )}
          {activeView === 'notes' && (
            <NotesView notes={notes} projects={projects} sidebarFilter={sidebarFilter} onSave={upsertNote} />
          )}
          {activeView === 'graph' && (
            <GraphView ideas={activeIdeas} projects={projects} tasks={tasks} notes={notes} selectedProjectId={selectedProjectId} />
          )}
          {activeView === 'focus' && (
            <FocusView ideas={activeIdeas} tasks={tasks} selectedProjectId={selectedProjectId} onMoveTask={moveTask} />
          )}
          {activeView === 'stats' && (
            <StatsView ideas={ideas} projects={projects} tasks={tasks} notes={notes} exportData={exportData} importData={importData} reload={async () => { await loadIdeas(); await loadWorkspace() }} onLoadDemoData={async () => { await importData(JSON.stringify(dummyData)); await loadIdeas(); await loadWorkspace() }} onClearAllData={async () => { await clearIdeas(); await clearWorkspace(); await loadIdeas(); await loadWorkspace() }} />
          )}
          {activeView === 'logs' && <LogViewer />}
          {SHOW_LOCAL_AI_SUGGESTIONS ? <AISuggestions ideas={ideas} projects={projects} tasks={tasks} /> : null}
        </main>

        <StatusDock
          isOpen={isStatusDockOpen}
          onClose={() => setIsStatusDockOpen(false)}
          authStatus={authStatus}
          workspaceBootstrap={workspaceBootstrap}
          sync={sync}
          ideasCount={ideas.length}
          projectsCount={projects.length}
          tasksCount={tasks.length}
          notesCount={notes.length}
          activeWorkspace={activeWorkspace}
        />

        {SHOW_MENTOR_PANEL ? (
          <MentorPanel
            isOpen={isMentorOpen}
            sessions={mentorSessions}
            activeSessionId={activeMentorId}
            onSelectSession={setActiveMentorId}
            onNewSession={() => {
              const session = ensureMentorSession()
              setActiveMentorId(session.id)
            }}
            onSendMessage={handleMentorSend}
            onClearSessions={() => {
              setMentorSessions([])
              setActiveMentorId(null)
            }}
          />
        ) : null}
      </div>

      {isCaptureOpen && (
        <CaptureModal
          destinationName={captureDestinationName}
          onClose={() => setIsCaptureOpen(false)}
          onSubmit={async ({ title, enhanceWithAI }) => {
            const ideaTitle = enhanceWithAI ? enhanceIdeaTitle(title) : title
            await createIdea({ title: ideaTitle, projectId: selectedProjectId ?? null })
            setIsCaptureOpen(false)
          }}
        />
      )}

      {creatingProject && (
        <CreateProjectModal
          onClose={() => setCreatingProject(false)}
          onSubmit={async (input) => {
            await createProject(input)
            setCreatingProject(false)
            setActiveView('dashboard')
          }}
        />
      )}

      {promotingIdea && (
        <PromotionModal
          idea={promotingIdea}
          onClose={() => setPromotingIdea(null)}
          onSubmit={async ({ whyNow, firstStep, doneLooksLike }) => {
            await promoteIdea(toPromoteInput(promotingIdea, whyNow, firstStep, doneLooksLike))
            await loadIdeas()
            setPromotingIdea(null)
            setActiveView('dashboard')
          }}
        />
      )}

      {flowMode && (
        <div className="flow-indicator">
          <div className="flow-indicator-dot" />
          You're in flow
          <button className="flow-exit-btn" onClick={() => setFlowMode(false)}>Break Flow</button>
        </div>
      )}

      {isCommandPaletteOpen && (
        <CommandPalette
          onClose={() => setIsCommandPaletteOpen(false)}
          onCapture={() => {setIsCommandPaletteOpen(false); setIsCaptureOpen(true)}}
          onNewNote={() => {setIsCommandPaletteOpen(false); setActiveView('notes')}}
          onFocusSearch={() => {setIsCommandPaletteOpen(false); document.querySelector<HTMLInputElement>('[aria-label="Search ideas"]')?.focus()}}
          onGoToView={(view) => {setIsCommandPaletteOpen(false); setActiveView(view)}}
          onEnterFlow={() => {setIsCommandPaletteOpen(false); setFlowMode(true)}}
        />
      )}

      {isSettingsOpen && (
        <SettingsModal
          theme={theme}
          onThemeChange={setTheme}
          activeWorkspace={activeWorkspace}
          supabaseEnv={supabaseEnv}
          authStatus={authStatus}
          workspaceBootstrap={workspaceBootstrap}
          aiSettings={aiSettings}
          workspaceMode={workspaceMode}
          onWorkspaceModeChange={setWorkspaceMode}
          onAISettingsChange={updateAISettings}
          sessionKeys={sessionKeys}
          onSessionKeyChange={(providerId, value) => {
            setSessionKeys((prev) => ({ ...prev, [providerId]: value }))
            setAcceptedPreviewHash(undefined)
            setSettingsSavedAt(new Date().toISOString())
          }}
          acceptedPreviewHash={acceptedPreviewHash}
          onAcceptPreview={(hash) => { setAcceptedPreviewHash(hash); setSettingsSavedAt(new Date().toISOString()) }}
          settingsSavedAt={settingsSavedAt}
          onClearData={async () => { await clearIdeas(); await clearWorkspace(); await loadIdeas(); await loadWorkspace() }}
          onClose={() => setIsSettingsOpen(false)}
        />
      )}
      {isSignInOpen && authStatus.mode !== 'signed-in' && (
        <SignInModal
          supabaseEnv={supabaseEnv}
          authStatus={authStatus}
          workspaceBootstrap={workspaceBootstrap}
          onClose={() => setIsSignInOpen(false)}
        />
      )}
      {isCreateWorkspaceOpen && (
        <CreateWorkspaceModal
          allowTeamWorkspaces={ENABLE_TEAM_WORKSPACES && supabaseEnv.configured && authStatus.mode === 'signed-in'}
          onCreate={async (name, type) => {
            const record = await createWorkspaceRecord({ name, type })
            setActiveWorkspace(record.id)
          }}
          onClose={() => setIsCreateWorkspaceOpen(false)}
        />
      )}
      {cloudMigrationPrompt ? (
        <CloudMigrationPrompt
          prompt={cloudMigrationPrompt}
          message={cloudMigrationMessage}
          onDismiss={() => {
            try {
              if (authStatus.userId) localStorage.setItem(CLOUD_MIGRATION_DISMISSED_STORAGE_KEY, authStatus.userId)
            } catch {
              // ignore storage failures
            }
            setCloudMigrationPrompt(null)
            setCloudMigrationMessage('')
          }}
          onMigrate={async () => {
            setCloudMigrationMessage('Migrating local data to your cloud workspace…')
            await importData(cloudMigrationPrompt.payload)
            await loadIdeas()
            await loadWorkspace()
            setCloudMigrationMessage('Local data migrated to cloud.')
            setCloudMigrationPrompt(null)
          }}
        />
      ) : null}
      <TutorialOverlay hasContent={ideas.length + projects.length > 0} />
    </main>
  )
}

function CloudMigrationPrompt({ prompt, message, onMigrate, onDismiss }: {
  prompt: LocalCloudMigrationPrompt
  message: string
  onMigrate: () => Promise<void>
  onDismiss: () => void
}) {
  const [isMigrating, setIsMigrating] = useState(false)
  return (
    <div className="modal-overlay" onClick={onDismiss}>
      <section className="brain-dump-modal" role="dialog" aria-modal="true" aria-labelledby="cloud-migration-title" onClick={(event) => event.stopPropagation()}>
        <div className="brain-dump-header">
          <div>
            <p className="eyebrow">Cloud workspace</p>
            <h3 id="cloud-migration-title">Move local data to cloud?</h3>
          </div>
          <button type="button" className="btn btn-ghost" onClick={onDismiss}>Skip</button>
        </div>
        <p className="settings-muted">
          Your Supabase workspace is empty, but this browser has local content. Importing copies the current local workspace into cloud without deleting local data.
        </p>
        <div className="stats-grid" aria-label="Local data available to migrate">
          <div className="stat-card"><span>Ideas</span><strong>{prompt.counts.ideas}</strong></div>
          <div className="stat-card"><span>Projects</span><strong>{prompt.counts.projects}</strong></div>
          <div className="stat-card"><span>Tasks</span><strong>{prompt.counts.tasks}</strong></div>
          <div className="stat-card"><span>Notes</span><strong>{prompt.counts.notes}</strong></div>
        </div>
        <div className="settings-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={isMigrating}
            onClick={async () => {
              setIsMigrating(true)
              try {
                await onMigrate()
              } finally {
                setIsMigrating(false)
              }
            }}
          >{isMigrating ? 'Migrating…' : 'Import to cloud'}</button>
          <button type="button" className="btn btn-secondary" onClick={onDismiss} disabled={isMigrating}>Remind me later</button>
        </div>
        {message ? <p className="settings-status">{message}</p> : null}
      </section>
    </div>
  )
}

function CaptureView({ ideas, buriedIdeas, isLoaded, onBury, onResurrect, onPromote, onCapture }: {
  ideas: Idea[]
  buriedIdeas: Idea[]
  isLoaded: boolean
  onBury: (id: string) => Promise<void>
  onResurrect: (id: string) => Promise<void>
  onPromote: (idea: Idea) => void
  onCapture: () => void
}) {
  const [filter, setFilter] = useState('all')

  const filteredIdeas = filter === 'all'
    ? ideas
    : ideas.filter(i => getIdeaTemperature(i.lastTouchedAt) === filter)

  return (
    <div className="capture view-enter">
      <div className="capture-header">
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 600, letterSpacing: '-0.02em', margin: 0 }}>
          Capture
        </h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" onClick={onCapture}>
            <Icon name="plus" /> Dump idea
          </button>
        </div>
      </div>

      <div className="stats-bar">
        <div className="stat-item">
          <Icon name="flame" />
          <span className="stat-value">{ideas.filter(i => getIdeaTemperature(i.lastTouchedAt) === 'hot').length}</span> hot
        </div>
        <div className="stat-item">
          <Icon name="clock" />
          <span className="stat-value">{ideas.filter(i => getIdeaTemperature(i.lastTouchedAt) === 'warm').length}</span> warm
        </div>
        <div className="stat-item">
          <Icon name="target" />
          <span className="stat-value">{ideas.filter(i => getIdeaTemperature(i.lastTouchedAt) === 'cool').length}</span> cooling
        </div>
        <div className="stat-item" style={{ opacity: 0.6 }}>
          <Icon name="archive" />
          <span className="stat-value">{ideas.filter(i => getIdeaTemperature(i.lastTouchedAt) === 'cold').length}</span> cold
        </div>
      </div>

      <div className="capture-filters" style={{ marginBottom: 24 }}>
        {['all', 'hot', 'warm', 'cool', 'cold'].map(f => (
          <button
            key={f}
            className={`filter-chip ${f} ${filter === f ? 'active' : ''}`}
            onClick={() => setFilter(f)}
          >
            {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      <div className="masonry-grid">
        {!isLoaded ? <p className="empty-state">Loading…</p> : null}
        {isLoaded && ideas.length === 0 ? (
          <button className="empty-state interactive" type="button" onClick={onCapture}>
            <Icon name="plus" /> Create your first idea
          </button>
        ) : null}
        {filteredIdeas.map((idea, i) => {
          const temp = getIdeaTemperature(idea.lastTouchedAt)
          return (
            <div key={idea.id} className={`idea-card idea-row ${temp}`} style={{ animationDelay: `${i * 50}ms` }}>
              <strong className="idea-card-title">{idea.title}</strong>
              {idea.body ? <div className="idea-card-body">{idea.body}</div> : null}
              <div className="idea-card-footer">
                <div style={{display: 'flex', gap: 4}}>
                  {idea.tags.map(tag => (
                    <span key={tag} className="idea-tag">{tag}</span>
                  ))}
                </div>
                <span className={`idea-temperature ${temp}`}>
                  {temp}
                </span>
              </div>
              <div className="idea-actions">
                {idea.status !== 'project' ? <button className="btn btn-secondary" style={{padding: '4px 8px', fontSize: 11}} onClick={(e) => {e.stopPropagation(); onPromote(idea)}}>Promote</button> : null}
                <button className="btn btn-ghost" style={{padding: '4px 8px', fontSize: 11}} onClick={(e) => {e.stopPropagation(); void onBury(idea.id)}}>Bury</button>
              </div>
            </div>
          )
        })}
      </div>

      {buriedIdeas.length > 0 ? (
        <details className="graveyard-preview">
          <summary>Graveyard · {buriedIdeas.length} buried</summary>
          {buriedIdeas.map((idea) => (
            <div className="buried-row" key={idea.id}>
              <span>{idea.title}</span>
              <button type="button" onClick={() => void onResurrect(idea.id)}>Resurrect</button>
            </div>
          ))}
        </details>
      ) : null}
    </div>
  )
}

function DashboardView({ projects, ideas, tasks, selectedProjectId, canDragIdeas, onCapture, onCreateProject, onOpenProject }: { projects: Project[]; ideas: Idea[]; tasks: Task[]; selectedProjectId?: string; canDragIdeas: boolean; onCapture: () => void; onCreateProject: () => void; onOpenProject: (projectId: string) => void }) {
  const [viewMode, setViewMode] = useState('grid')
  const displayProjects = selectedProjectId ? projects.filter((project) => project.id === selectedProjectId) : projects
  const linkedIdeas = selectedProjectId ? ideas.filter((idea) => idea.projectId === selectedProjectId) : []

  return (
    <div className="dashboard view-enter">
      <div className="main-header">
        <div>
          <h1>General Knowledge</h1>
          {selectedProjectId ? <p className="dashboard-subtitle">Adding ideas will attach to {projects.find((p) => p.id === selectedProjectId)?.title ?? 'this project'}.</p> : null}
        </div>
        <div className="main-header-actions">
          <button className="btn btn-secondary" onClick={onCreateProject}><Icon name="plus" /> New Folder</button>
          <button className="btn btn-primary" onClick={onCapture}><Icon name="plus" /> Dump idea</button>
        </div>
      </div>

      <div className="stats-bar">
        <div className="stat-item">
          <Icon name="folder" />
          <span className="stat-value">{displayProjects.length}</span> projects
        </div>
        <div className="stat-item">
          <Icon name="fileText" />
          <span className="stat-value">{tasks.length}</span> tasks
        </div>
      </div>

      <div className="section-header">
        <h2>Projects <span className="count">{displayProjects.length}</span></h2>
        <div className="section-header-actions">
          <button className={viewMode === 'grid' ? 'active' : ''} onClick={() => setViewMode('grid')}>
            <Icon name="grid" />
          </button>
          <button className={viewMode === 'list' ? 'active' : ''} onClick={() => setViewMode('list')}>
            <Icon name="list" />
          </button>
        </div>
      </div>

      {viewMode === 'grid' ? (
        <div className="folders-grid">
          {displayProjects.length === 0 ? (
            <div className="folder-card" onClick={onCreateProject}>
              <div className="folder-icon">
                <div className="folder-icon-tab" />
                <div className="folder-icon-body" />
              </div>
              <div className="folder-card-name">No projects yet</div>
              <div className="folder-card-count">Promote an idea to start</div>
            </div>
          ) : (
            displayProjects.map((project, i) => (
              <div key={project.id} className="folder-card" style={{ animationDelay: `${i * 60}ms` }} onClick={() => onOpenProject(project.id)}>
                <div className="folder-icon">
                  <div className="folder-icon-tab" />
                  <div className="folder-icon-body">
                    <div className="folder-doc-preview-back" />
                    <div className="folder-doc-preview" />
                  </div>
                </div>
                <div className="folder-card-name">{project.title}</div>
                <div className="folder-card-count">{tasks.filter(t => t.projectId === project.id).length} tasks</div>
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="files-list" style={{ marginBottom: 32 }}>
          {displayProjects.map((project, i) => (
            <div key={project.id} className="file-row" style={{ animationDelay: `${i * 40}ms` }} onClick={() => onOpenProject(project.id)}>
              <div className="file-icon doc">P</div>
              <div className="file-name">{project.title}</div>
              <div className="file-meta">{project.status}</div>
            </div>
          ))}
        </div>
      )}

      {selectedProjectId ? (
        <>
          <div className="section-header" style={{ marginTop: 8 }}>
            <h2>Linked idea records <span className="count">{linkedIdeas.length}</span></h2>
          </div>
          {!canDragIdeas ? <p className="dashboard-helper">Drag to project folders is available when sidebar is visible.</p> : null}
          <div className="files-list" style={{ marginBottom: 32 }}>
            {linkedIdeas.map((idea, i) => <DraggableIdeaRecord key={idea.id} idea={idea} index={i} canDrag={canDragIdeas} />)}
            {linkedIdeas.length === 0 ? <p className="empty-state">Ideas captured in this project context will appear here.</p> : null}
          </div>
        </>
      ) : null}

      <div className="section-header" style={{ marginTop: 8 }}>
        <h2>Commitment records <span className="count">{displayProjects.length}</span></h2>
      </div>

      <div className="files-list">
        {displayProjects.map((project, i) => (
          <div key={project.id} className="file-row" style={{ animationDelay: `${i * 40 + 200}ms` }}>
            <div className="file-icon md">M</div>
            <div className="file-name">
              <strong>{project.title}</strong>
              <span style={{color: 'var(--muted)', marginLeft: 8, fontSize: 12}}>Why now: {project.whyNow}</span>
            </div>
            <div className="file-meta" style={{width: 150}}>{project.doneLooksLike}</div>
          </div>
        ))}
        {displayProjects.length === 0 ? <p className="empty-state">Promoted projects will appear here with their commitment bridge.</p> : null}
      </div>
    </div>
  )
}

function DraggableIdeaRecord({ idea, index, canDrag }: { idea: Idea; index: number; canDrag: boolean }) {
  const [isDragging, setIsDragging] = useState(false)
  return (
    <div
      className={`file-row idea-record-row ${canDrag ? 'draggable' : ''} ${isDragging ? 'is-dragging' : ''}`}
      style={{ animationDelay: `${index * 40}ms` }}
      draggable={canDrag}
      role="button"
      tabIndex={0}
      aria-label={`Idea record: ${idea.title}`}
      onDragStart={(event) => {
        if (!canDrag) {
          event.preventDefault()
          return
        }
        setIsDragging(true)
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData(IDEA_DRAG_MIME, JSON.stringify({ ideaId: idea.id }))
        event.dataTransfer.setData('text/plain', idea.id)
      }}
      onDragEnd={() => setIsDragging(false)}
    >
      <div className="file-icon doc">I</div>
      <div className="file-name">{idea.title}</div>
      <div className="file-meta">{getIdeaTemperature(idea.lastTouchedAt)}</div>
    </div>
  )
}

function KanbanView({ projects, tasks, activeProjectId, onMoveTask, onCreateTask, onUpdateTask }: { projects: Project[]; tasks: Task[]; activeProjectId?: string; onMoveTask: (id: string, columnId: TaskColumn) => Promise<void>; onCreateTask: (input: CreateTaskInput) => Promise<void>; onUpdateTask: (id: string, input: UpdateTaskInput) => Promise<void> }) {
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? projects[0]
  const visibleTasks = activeProject ? tasks.filter((task) => task.projectId === activeProject.id) : tasks
  const today = getTodayDateInputValue()
  const plannedToday = visibleTasks
    .filter((task) => task.columnId !== 'done')
    .filter((task) => task.scheduledDate === today || (!!task.dueDate && task.dueDate <= today))
  const newTaskFormRef = useRef<HTMLDivElement>(null)

  return (
    <div className="kanban view-enter">
      <div className="kanban-header">
        <div className="kanban-project-selector" aria-live="polite">
          <span className="kanban-project-name">{activeProject ? activeProject.title : 'Promote an idea to create a board'}</span>
          <p id="kanban-keyboard-help" className="kanban-a11y-hint">Keyboard: focus a card, then press Alt + ←/→ to move it.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" onClick={() => { newTaskFormRef.current?.querySelector<HTMLInputElement>('[aria-label="New task title"]')?.focus() }}><Icon name="plus" /> New Task</button>
        </div>
      </div>

      {plannedToday.length > 0 ? (
        <section className="kanban-today" aria-label="Today and overdue tasks">
          <div>
            <span className="kanban-today-label">Today</span>
            <strong>{plannedToday.length} planned or due</strong>
          </div>
          <div className="kanban-today-list">
            {plannedToday.slice(0, 4).map((task) => (
              <span key={task.id} className="kanban-today-chip">
                {task.title}
                {task.dueDate && task.dueDate <= today ? <em>{task.dueDate < today ? 'overdue' : 'due'}</em> : null}
              </span>
            ))}
          </div>
        </section>
      ) : null}

      <div className="kanban-columns">
        {taskColumns.map((column) => (
          <DroppableKanbanColumn key={column.id} column={column} tasks={visibleTasks.filter((task) => task.columnId === column.id)} onMoveTask={onMoveTask} onUpdateTask={onUpdateTask} />
        ))}
      </div>

      {activeProject ? (
        <div ref={newTaskFormRef}>
          <QuickTaskForm projectId={activeProject.id} onCreateTask={onCreateTask} />
        </div>
      ) : null}
    </div>
  )
}

function QuickTaskForm({ projectId, onCreateTask }: { projectId: string; onCreateTask: (input: CreateTaskInput) => Promise<void> }) {
  const [taskTitle, setTaskTitle] = useState('')
  const [scheduledDate, setScheduledDate] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const quickTaskRef = useRef<HTMLInputElement>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!taskTitle.trim() || submitting) return
    setSubmitting(true)
    try {
      await onCreateTask({ projectId, title: taskTitle.trim(), scheduledDate: scheduledDate || null, dueDate: dueDate || null })
      setTaskTitle('')
      setScheduledDate('')
      setDueDate('')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form className="quick-task-form" onSubmit={handleSubmit}>
      <input ref={quickTaskRef} aria-label="New task title" value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} placeholder="Add another task to this project..." />
      <label className="quick-task-date">
        Plan
        <input aria-label="Planned date" type="date" value={scheduledDate} onChange={(event) => setScheduledDate(event.target.value)} />
      </label>
      <label className="quick-task-date">
        Due
        <input aria-label="Due date" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
      </label>
      <button className="btn btn-primary" type="submit" disabled={submitting}>Add task</button>
    </form>
  )
}

function getTodayDateInputValue(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function formatTaskDate(value: string): string {
  const [y, m, d] = value.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function DroppableKanbanColumn({ column, tasks, onMoveTask, onUpdateTask }: { column: { id: TaskColumn; label: string }; tasks: Task[]; onMoveTask: (id: string, columnId: TaskColumn) => Promise<void>; onUpdateTask: (id: string, input: UpdateTaskInput) => Promise<void> }) {
  const [isOver, setIsOver] = useState(false)
  return (
    <div
      className={isOver ? 'kanban-column drag-over' : 'kanban-column'}
      role="region"
      aria-label={`${column.label} tasks`}
      onDragEnter={() => setIsOver(true)}
      onDragLeave={() => setIsOver(false)}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault()
        setIsOver(false)
        const taskId = event.dataTransfer.getData('text/plain')
        if (taskId) void onMoveTask(taskId, column.id)
      }}
    >
      <div className="kanban-column-header">
        <span className="kanban-column-title">{column.label}</span>
        <span className="kanban-column-count">{tasks.length}</span>
      </div>
      <div className="kanban-cards">
        {tasks.map((task, i) => <DraggableTaskCard key={task.id} task={task} index={i} onMoveTask={onMoveTask} onUpdateTask={onUpdateTask} />)}
        {tasks.length === 0 ? <p className="kanban-add-card" style={{border: '1px dashed var(--border)'}}>Drop tasks here</p> : null}
      </div>
    </div>
  )
}

function getAdjacentColumnId(columnId: TaskColumn, direction: -1 | 1): TaskColumn | undefined {
  const currentIndex = taskColumns.findIndex((column) => column.id === columnId)
  return taskColumns[currentIndex + direction]?.id
}

function DraggableTaskCard({ task, index, onMoveTask, onUpdateTask }: { task: Task; index: number; onMoveTask: (id: string, columnId: TaskColumn) => Promise<void>; onUpdateTask: (id: string, input: UpdateTaskInput) => Promise<void> }) {
  const [isDragging, setIsDragging] = useState(false)
  const [editingDate, setEditingDate] = useState<'scheduledDate' | 'dueDate' | null>(null)
  const [editValue, setEditValue] = useState('')
  const editRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editingDate) editRef.current?.focus()
  }, [editingDate])

  function startEdit(field: 'scheduledDate' | 'dueDate') {
    setEditValue(task[field] ?? '')
    setEditingDate(field)
  }

  async function commitEdit() {
    const field = editingDate
    if (!field) return
    setEditingDate(null)
    const value = editValue || null
    if (value === task[field]) return
    await onUpdateTask(task.id, { [field]: value } as UpdateTaskInput)
  }

  function cancelEdit() {
    setEditingDate(null)
  }

  return (
    <div
      className={isDragging ? 'kanban-card is-dragging' : 'kanban-card'}
      style={{ animationDelay: `${index * 50 + 100}ms` }}
      draggable
      tabIndex={0}
      role="button"
      aria-label={`Task: ${task.title}. Press Alt and arrow keys to move across columns.`}
      aria-describedby="kanban-keyboard-help"
      onDragStart={(event) => {
        setIsDragging(true)
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('text/plain', task.id)
      }}
      onDragEnd={() => setIsDragging(false)}
      onKeyDown={(event) => {
        if (!event.altKey || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return
        event.preventDefault()
        const targetColumn = getAdjacentColumnId(task.columnId, event.key === 'ArrowRight' ? 1 : -1)
        if (targetColumn) void onMoveTask(task.id, targetColumn)
      }}
    >
      <div className="kanban-card-title">{task.title}</div>
      <div className="kanban-card-dates">
        {editingDate === 'scheduledDate' ? (
          <span className="kanban-date-edit">
            Plan
            <input ref={editRef} aria-label="Planned date" type="date" value={editValue} onChange={(e) => setEditValue(e.target.value)} onBlur={() => void commitEdit()} onKeyDown={(e) => { if (e.key === 'Enter') void commitEdit(); if (e.key === 'Escape') cancelEdit() }} />
          </span>
        ) : task.scheduledDate ? (
          <span role="button" tabIndex={0} aria-label="Edit planned date" onClick={() => startEdit('scheduledDate')} onKeyDown={(e) => { if (e.key === 'Enter') startEdit('scheduledDate') }}>Plan {formatTaskDate(task.scheduledDate)}</span>
        ) : (
          <span role="button" tabIndex={0} aria-label="Set planned date" className="kanban-date-empty" onClick={() => startEdit('scheduledDate')} onKeyDown={(e) => { if (e.key === 'Enter') startEdit('scheduledDate') }}>+ Plan</span>
        )}
        {editingDate === 'dueDate' ? (
          <span className="kanban-date-edit">
            Due
            <input ref={editRef} aria-label="Due date" type="date" value={editValue} onChange={(e) => setEditValue(e.target.value)} onBlur={() => void commitEdit()} onKeyDown={(e) => { if (e.key === 'Enter') void commitEdit(); if (e.key === 'Escape') cancelEdit() }} />
          </span>
        ) : task.dueDate ? (
          <span role="button" tabIndex={0} aria-label="Edit due date" className={task.dueDate < getTodayDateInputValue() && task.columnId !== 'done' ? 'overdue' : ''} onClick={() => startEdit('dueDate')} onKeyDown={(e) => { if (e.key === 'Enter') startEdit('dueDate') }}>Due {formatTaskDate(task.dueDate)}</span>
        ) : (
          <span role="button" tabIndex={0} aria-label="Set due date" className="kanban-date-empty" onClick={() => startEdit('dueDate')} onKeyDown={(e) => { if (e.key === 'Enter') startEdit('dueDate') }}>+ Due</span>
        )}
      </div>
      <div className="kanban-card-meta">
        <span className={`kanban-priority ${task.priority.toLowerCase()}`}>{task.priority}</span>
        <span style={{fontSize: 11, color: 'var(--muted)'}}>{task.completionPct}%</span>
      </div>
    </div>
  )
}

function NotesView({ notes, projects, sidebarFilter, onSave }: { notes: Note[]; projects: Project[]; sidebarFilter: SidebarFilter; onSave: (input: { id?: string; title: string; content: string; linkedProjectId?: string | null; voiceRecordings?: VoiceRecording[] }) => Promise<string | void> }) {
  const filteredNotes = useMemo(() => {
    if (sidebarFilter.kind === 'all') return notes.filter((n) => !n.linkedProjectId)
    if (sidebarFilter.kind === 'project') return notes.filter((n) => n.linkedProjectId === sidebarFilter.projectId)
    return notes
  }, [notes, sidebarFilter])
  const selectedProjectId = sidebarFilter.kind === 'project' ? sidebarFilter.projectId : undefined
  const [userActiveId, setUserActiveId] = useState<string | undefined>(filteredNotes[0]?.id)
  const activeId = useMemo(() => {
    if (userActiveId === undefined) return undefined
    const stillVisible = filteredNotes.some((n) => n.id === userActiveId)
    return stillVisible ? userActiveId : filteredNotes[0]?.id
  }, [userActiveId, filteredNotes])

  const emptyMessage = sidebarFilter.kind === 'all' ? 'No general notes yet.' : sidebarFilter.kind === 'project' ? 'No notes for this project yet.' : 'No notes yet.'

  return (
    <div className="notes-layout view-enter">
      <div className="notes-sidebar">
        <div className="notes-sidebar-header">
          <h3>Notes</h3>
          <button type="button" className="toolbar-btn" title="New note" aria-label="New note" onClick={() => setUserActiveId(undefined)}>
            <Icon name="plus" />
          </button>
        </div>
        <div className="notes-list">
          {filteredNotes.map(n => (
            <div
              key={n.id}
              className={`note-item ${activeId === n.id ? 'active' : ''}`}
              onClick={() => setUserActiveId(n.id)}
            >
              <div className="note-item-title">{n.title}</div>
              <div className="note-item-preview">{plainTextPreview(n.content, 50)}...</div>
              <div className="note-item-date">{new Date(n.updatedAt).toLocaleDateString()}</div>
            </div>
          ))}
          {filteredNotes.length === 0 ? <p style={{padding: 16, fontSize: 12, color: 'var(--muted)'}}>{emptyMessage}</p> : null}
        </div>
      </div>

      <NoteEditor key={activeId || 'new'} activeId={activeId} notes={notes} projects={projects} selectedProjectId={selectedProjectId} onSave={(input) => onSave(input).then((id) => { if (id) setUserActiveId(id) })} />
    </div>
  )
}

function escapeHtml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

function sanitizeMarkdownHref(href: string): string {
  const trimmed = href.trim()
  const stripped = trimmed.replace(/[\p{Cf}\u200B-\u200F\u2028-\u202F\uFEFF]/gu, '')
  const normalized = Array.from(stripped).filter((char) => char.charCodeAt(0) > 0x20 && char.charCodeAt(0) !== 0x7f).join('').toLowerCase()
  if (
    normalized.startsWith('javascript:')
    || normalized.startsWith('data:')
    || normalized.startsWith('vbscript:')
    || normalized.startsWith('file:')
  ) {
    return '#'
  }
  return trimmed || '#'
}

function renderMarkdown(md: string): string {
  return escapeHtml(md)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label: string, href: string) => `<a href="${sanitizeMarkdownHref(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`)
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.+<\/li>\n?)+/g, '<ul>$&</ul>')
}

function plainTextPreview(md: string, max = 50): string {
  const text = md
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/^- /gm, '')
  return text.substring(0, max)
}

function NoteEditor({ activeId, notes, projects, selectedProjectId, onSave }: { activeId?: string; notes: Note[]; projects: Project[]; selectedProjectId?: string; onSave: (input: { id?: string; title: string; content: string; linkedProjectId?: string | null; voiceRecordings?: VoiceRecording[] }) => Promise<void> }) {
  const initialNote = notes.find((note) => note.id === activeId)
  const [title, setTitle] = useState(initialNote?.title ?? 'Untitled note')
  const [content, setContent] = useState(initialNote?.content ?? '')
  const [linkedProjectId] = useState<string>(initialNote?.linkedProjectId ?? selectedProjectId ?? '')
  const [isRecording, setIsRecording] = useState(false)
  const [recordings, setRecordings] = useState<VoiceRecording[]>(initialNote?.voiceRecordings ?? [])
  const [previewMode, setPreviewMode] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [saveError, setSaveError] = useState('')
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const startTimeRef = useRef<number>(0)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    return () => {
      mountedRef.current = false
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop()
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop())
        streamRef.current = null
      }
      mediaRecorderRef.current = null
    }
  }, [])

  const wrapSelection = useCallback((before: string, after: string = before) => {
    const el = textareaRef.current
    if (!el) return
    const start = el.selectionStart
    const end = el.selectionEnd
    const selected = content.substring(start, end)
    const newContent = content.substring(0, start) + before + selected + after + content.substring(end)
    setContent(newContent)
    requestAnimationFrame(() => {
      el.focus()
      const caret = start + before.length + selected.length
      el.setSelectionRange(caret, caret)
    })
  }, [content])

  const recordingSupported = useMemo(() => {
    return typeof window !== 'undefined' && 'MediaRecorder' in window && 'navigator' in window && 'mediaDevices' in navigator
  }, [])

  const startRecording = useCallback(async () => {
    if (!recordingSupported) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mediaRecorder = new MediaRecorder(stream)
      mediaRecorderRef.current = mediaRecorder
      chunksRef.current = []

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        const reader = new FileReader()
        reader.onloadend = () => {
          if (!mountedRef.current) return
          const dataUrl = reader.result as string
          if (dataUrl.length > MAX_VOICE_RECORDING_DATA_URL_LENGTH) {
            setIsRecording(false)
            return
          }
          const durationMs = Date.now() - startTimeRef.current
          setRecordings((prev) => [...prev, {
            id: crypto.randomUUID(),
            dataUrl,
            durationMs,
            createdAt: new Date().toISOString(),
          }])
          setIsRecording(false)
        }
        reader.readAsDataURL(blob)
        stream.getTracks().forEach((track) => track.stop())
        streamRef.current = null
      }

      startTimeRef.current = Date.now()
      mediaRecorder.start()
      setIsRecording(true)
    } catch {
      setIsRecording(false)
    }
  }, [recordingSupported])

  const stopRecording = useCallback(() => {
    mediaRecorderRef.current?.stop()
  }, [])

  const removeRecording = useCallback((id: string) => {
    setRecordings((prev) => prev.filter((r) => r.id !== id))
  }, [])

  return (
    <>
      <div className="notes-editor">
        <div className="notes-editor-toolbar" aria-label="Local document">
          {!previewMode && (
            <>
              <button type="button" className="toolbar-btn" title="Bold" onClick={() => wrapSelection('**')}><Icon name="bold" /></button>
              <button type="button" className="toolbar-btn" title="Italic" onClick={() => wrapSelection('*')}><Icon name="italic" /></button>
              <button type="button" className="toolbar-btn" title="Code" onClick={() => wrapSelection('`')}><Icon name="code" /></button>
              <div className="toolbar-divider" />
              <button type="button" className="toolbar-btn" title="Link" onClick={() => wrapSelection('[', '](url)')}><Icon name="link" /></button>
              <button type="button" className="toolbar-btn" title="List" onClick={() => wrapSelection('- ')}><Icon name="list" /></button>
            </>
          )}
          {recordingSupported && (
            <button
              type="button"
              className={`toolbar-btn ${isRecording ? 'recording' : ''}`}
              title={isRecording ? 'Stop recording' : 'Record voice memo'}
              onClick={isRecording ? stopRecording : startRecording}
            >
              <Icon name="mic" />
            </button>
          )}
          <div className="toolbar-divider" />
          <button
            type="button"
            className={`toolbar-btn ${previewMode ? 'active' : ''}`}
            title={previewMode ? 'Edit' : 'Preview'}
            onClick={() => setPreviewMode((prev) => !prev)}
          >
            <Icon name="eye" />
          </button>
        </div>
        {isRecording && <span className="note-recording-indicator">Recording…</span>}
        <form className="notes-editor-content" onSubmit={async (event) => { event.preventDefault(); if (submitting) return; setSubmitting(true); setSaveError(''); try { await onSave({ id: activeId, title, content, linkedProjectId: linkedProjectId || null, voiceRecordings: recordings }) } catch (err) { setSaveError(err instanceof Error ? err.message : String(err)) } finally { setSubmitting(false) } }}>
          <h3 className="sr-only" style={{display: 'none'}}>Local document</h3>
          <input className="note-title-input" aria-label="Note title" value={title} onChange={(event) => setTitle(event.target.value)} />
          {previewMode ? (
            <div className="note-preview" aria-label="Preview" dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }} />
          ) : (
            <textarea ref={textareaRef} className="note-body-input" aria-label="Note content" value={content} onChange={(event) => setContent(event.target.value)} placeholder="Write notes, context, decisions, and backlinks here..." />
          )}
          {recordings.length > 0 && (
            <div className="note-recordings">
              {recordings.map((rec) => (
                <div key={rec.id} className="note-recording">
                  <audio controls src={rec.dataUrl} style={{ height: 32 }} />
                  <button type="button" className="btn btn-ghost" onClick={() => removeRecording(rec.id)} title="Delete recording" aria-label="Delete recording">×</button>
                </div>
              ))}
            </div>
          )}
          <button className="btn btn-primary" type="submit" disabled={submitting}>Save note</button>
          {saveError ? <p className="settings-status settings-status--error">{saveError}</p> : null}
        </form>
      </div>

      <div className="notes-linked">
        <h4>Linked Entities</h4>
        {linkedProjectId ? projects.filter(p => p.id === linkedProjectId).map((project, i) => (
          <div key={i} className="linked-entity">
            <div className="linked-entity-icon project"><Icon name="folder" /></div>
            <div>
              <div className="linked-entity-title">{project.title}</div>
              <div className="linked-entity-type">project</div>
            </div>
          </div>
        )) : <p style={{fontSize: 12, color: 'var(--muted)'}}>No linked entities.</p>}
      </div>
    </>
  )
}

function GraphView({ ideas, projects, tasks, notes, selectedProjectId }: { ideas: Idea[]; projects: Project[]; tasks: Task[]; notes: Note[]; selectedProjectId?: string }) {
  const nodes = useMemo<GraphNode[]>(() => {
    const accents: Record<GraphNodeKind, string> = {
      Idea: 'var(--warning)',
      Project: 'var(--accent)',
      Task: 'var(--success)',
      Note: 'oklch(62% .15 315)',
    }

    const center = { x: 50, y: 50 }
    const projectItems = (selectedProjectId ? [...projects].sort((a, b) => (a.id === selectedProjectId ? -1 : b.id === selectedProjectId ? 1 : 0)) : projects).slice(0, 6)

    // Projects on an evenly-distributed ring around the hub.
    const projCount = projectItems.length
    const projRadiusX = 28
    const projRadiusY = 22
    // Rotate the ring so single/odd counts start at top (-90°), not at the right.
    const projBaseAngle = -Math.PI / 2
    const projectNodes = projectItems.map((item, index) => {
      const angle = projBaseAngle + (projCount > 0 ? (index / projCount) * Math.PI * 2 : 0)
      return {
        id: item.id,
        label: item.title,
        kind: 'Project' as const,
        detail: `Project lane ${index + 1}`,
        lane: 1,
        order: index,
        x: clampGraphPoint(center.x + Math.cos(angle) * projRadiusX),
        y: clampGraphPoint(center.y + Math.sin(angle) * projRadiusY),
        accent: accents.Project,
      }
    })

    const projectNodeMap = new Map(projectNodes.map((node) => [node.id, node]))
    const projectFallbackIds = projectItems.map((item) => item.id)

    // Group ideas by effective parent so we can fan each group out without overlap.
    const ideaItems = ideas.slice(0, 6)
    const ideasByParent = new Map<string | null, Array<{ idea: Idea; originalIndex: number }>>()
    ideaItems.forEach((idea, originalIndex) => {
      const parentId = idea.projectId && projectNodeMap.has(idea.projectId)
        ? idea.projectId
        : projectFallbackIds[originalIndex % Math.max(projectFallbackIds.length, 1)] ?? null
      const bucket = ideasByParent.get(parentId) ?? []
      bucket.push({ idea, originalIndex })
      ideasByParent.set(parentId, bucket)
    })

    const ideaRadiusX = 44
    const ideaRadiusY = 38
    const ideaNodes: GraphNode[] = []
    for (const [parentId, bucket] of ideasByParent) {
      const parent = parentId ? projectNodeMap.get(parentId) : undefined
      // Parent's polar angle from center (fallback: top) gives the ideas' base direction.
      const baseAngle = parent
        ? Math.atan2(parent.y - center.y, parent.x - center.x)
        : -Math.PI / 2
      const count = bucket.length
      // Fan ideas through an angular wedge sized with the group's count, capped at ~85°.
      const wedge = Math.min(count * 0.22, Math.PI * 0.48)
      bucket.forEach(({ idea, originalIndex }, groupIndex) => {
        const fraction = count > 1 ? (groupIndex / (count - 1)) - 0.5 : 0
        const angle = baseAngle + fraction * wedge
        ideaNodes.push({
          id: idea.id,
          label: idea.title,
          kind: 'Idea',
          detail: parent ? `Idea branch • ${parent.label}` : 'Idea branch',
          lane: 0,
          order: originalIndex,
          x: clampGraphPoint(center.x + Math.cos(angle) * ideaRadiusX),
          y: clampGraphPoint(center.y + Math.sin(angle) * ideaRadiusY),
          accent: accents.Idea,
          anchorId: parentId,
        })
      })
    }

    // Tasks on a bottom semicircular arc so they read as a work front below the hub.
    const taskItems = tasks.slice(0, 6)
    const taskRadiusX = 38
    const taskRadiusY = 34
    const taskNodes = taskItems.map((item, index) => {
      const total = taskItems.length
      // Sweep from 0.15π → 0.85π (east-below to west-below) with even spacing.
      const angle = total > 1
        ? Math.PI * 0.15 + (index / (total - 1)) * Math.PI * 0.7
        : Math.PI * 0.5
      const parent = item.projectId && projectNodeMap.has(item.projectId)
        ? projectNodeMap.get(item.projectId)
        : projectNodes[index % Math.max(projectNodes.length, 1)]
      return {
        id: item.id,
        label: item.title,
        kind: 'Task' as const,
        detail: parent ? `Work lane • ${parent.label}` : 'Work lane',
        lane: 2,
        order: index,
        x: clampGraphPoint(center.x + Math.cos(angle) * taskRadiusX),
        y: clampGraphPoint(center.y + Math.sin(angle) * taskRadiusY),
        accent: accents.Task,
        anchorId: parent?.id ?? null,
      }
    })

    // Notes on a top arc, mirroring the task row.
    const noteItems = notes.slice(0, 6)
    const noteRadiusX = 40
    const noteRadiusY = 32
    const noteNodes = noteItems.map((item, index) => {
      const total = noteItems.length
      const angle = total > 1
        ? -Math.PI * 0.15 - (index / (total - 1)) * Math.PI * 0.7
        : -Math.PI * 0.5
      const parent = item.linkedProjectId && projectNodeMap.has(item.linkedProjectId)
        ? projectNodeMap.get(item.linkedProjectId)
        : (item.linkedIdeaId ? ideaNodes.find((ideaNode) => ideaNode.id === item.linkedIdeaId) : undefined)
      return {
        id: item.id,
        label: item.title,
        kind: 'Note' as const,
        detail: parent ? `Note sat • ${parent.label}` : 'Note sat',
        lane: 3,
        order: index,
        x: clampGraphPoint(center.x + Math.cos(angle) * noteRadiusX),
        y: clampGraphPoint(center.y + Math.sin(angle) * noteRadiusY),
        accent: accents.Note,
        anchorId: parent?.id ?? null,
      }
    })

    const combined: GraphNode[] = [...projectNodes, ...ideaNodes, ...taskNodes, ...noteNodes]

    // Collision relaxation: push overlapping nodes apart, keeping projects pinned.
    // Two passes is enough for typical counts (<=24 nodes) and stays cheap.
    const minDist = 14 // minimum separation in viewport percent
    const positions = combined.map((node) => ({
      id: node.id,
      x: node.x,
      y: node.y,
      locked: node.kind === 'Project',
    }))
    for (let iter = 0; iter < 4; iter++) {
      for (let i = 0; i < positions.length; i++) {
        for (let j = i + 1; j < positions.length; j++) {
          const a = positions[i]
          const b = positions[j]
          const dx = b.x - a.x
          const dy = b.y - a.y
          const dist = Math.hypot(dx, dy) || 0.001
          if (dist >= minDist) continue
          const push = (minDist - dist) / 2
          const nx = dx / dist
          const ny = dy / dist
          if (a.locked && b.locked) continue
          if (a.locked) {
            b.x += nx * push * 2
            b.y += ny * push * 2
          } else if (b.locked) {
            a.x -= nx * push * 2
            a.y -= ny * push * 2
          } else {
            a.x -= nx * push
            a.y -= ny * push
            b.x += nx * push
            b.y += ny * push
          }
        }
      }
    }
    const positionById = new Map(positions.map((p) => [p.id, p]))
    return combined.map((node) => {
      const resolved = positionById.get(node.id)
      return resolved ? { ...node, x: clampGraphPoint(resolved.x), y: clampGraphPoint(resolved.y) } : node
    })
  }, [ideas, notes, projects, selectedProjectId, tasks])

  const edges = useMemo<GraphEdge[]>(() => {
    const projectNodeIds = new Set(projects.map((project) => project.id))
    const ideaNodeIds = new Set(ideas.map((idea) => idea.id))
    const hasProjects = projectNodeIds.size > 0

    const relationEdges: GraphEdge[] = []

    if (hasProjects) {
      projects.slice(0, 6).forEach((project) => {
        relationEdges.push({ id: `hub-project-${project.id}`, from: 'hub', to: project.id, label: 'centers' })
      })
    }

    ideas.forEach((idea) => {
      if (idea.projectId && projectNodeIds.has(idea.projectId)) {
        relationEdges.push({ id: `idea-project-${idea.id}-${idea.projectId}`, from: idea.id, to: idea.projectId, label: 'shapes' })
      } else if (!hasProjects) {
        relationEdges.push({ id: `hub-idea-${idea.id}`, from: 'hub', to: idea.id, label: 'centers' })
      }
    })

    tasks.forEach((task) => {
      if (projectNodeIds.has(task.projectId)) {
        relationEdges.push({ id: `task-project-${task.id}-${task.projectId}`, from: task.projectId, to: task.id, label: 'hosts' })
      } else if (!hasProjects) {
        relationEdges.push({ id: `hub-task-${task.id}`, from: 'hub', to: task.id, label: 'centers' })
      }
      if (task.ideaId && ideaNodeIds.has(task.ideaId)) {
        relationEdges.push({ id: `task-idea-${task.id}-${task.ideaId}`, from: task.ideaId, to: task.id, label: 'unpacks' })
      }
    })

    notes.forEach((note) => {
      if (note.linkedProjectId && projectNodeIds.has(note.linkedProjectId)) {
        relationEdges.push({ id: `note-project-${note.id}-${note.linkedProjectId}`, from: note.id, to: note.linkedProjectId, label: 'supports' })
      } else if (!hasProjects) {
        relationEdges.push({ id: `hub-note-${note.id}`, from: 'hub', to: note.id, label: 'centers' })
      }
      if (note.linkedIdeaId && ideaNodeIds.has(note.linkedIdeaId)) {
        relationEdges.push({ id: `note-idea-${note.id}-${note.linkedIdeaId}`, from: note.id, to: note.linkedIdeaId, label: 'captures' })
      }
    })

    return relationEdges
  }, [ideas, notes, projects, tasks])

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [zoom, setZoom] = useState(0.86)
  const [nodePositions, setNodePositions] = useState<Record<string, GraphPoint>>(() => Object.fromEntries(nodes.map((node) => [node.id, { x: node.x, y: node.y }])))
  const [showInspector, setShowInspector] = useState(true)
  const [showList, setShowList] = useState(true)
  const [isRelayingOut, setIsRelayingOut] = useState(false)
  const relayoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const graphStageRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<{ id: string; pointerId: number; offsetX: number; offsetY: number } | null>(null)
  const hub = { id: 'hub', x: 50, y: 50, accent: 'var(--accent)' }

  useEffect(() => () => {
    if (relayoutTimerRef.current) clearTimeout(relayoutTimerRef.current)
  }, [])

  const resetLayout = () => {
    setIsRelayingOut(true)
    setNodePositions(Object.fromEntries(nodes.map((node) => [node.id, { x: node.x, y: node.y }])))
    if (relayoutTimerRef.current) clearTimeout(relayoutTimerRef.current)
    relayoutTimerRef.current = setTimeout(() => {
      setIsRelayingOut(false)
      relayoutTimerRef.current = null
    }, 620)
  }

  const updateZoom = (nextZoom: number) => setZoom(Math.max(0.75, Math.min(1.4, Number(nextZoom.toFixed(2)))))
  const showSidebar = showInspector || showList

  const positions = useMemo(() => nodes.map((node) => ({ ...node, ...(nodePositions[node.id] ?? { x: node.x, y: node.y }) })), [nodePositions, nodes])
  const hubEdges = positions.filter((node) => node.kind === 'Project').map((node) => ({ id: `hub-${node.id}`, from: hub, to: node }))
  const selectedNode = positions.find((node) => node.id === selectedNodeId) ?? null
  const selectedEdges = selectedNode ? edges.filter((edge) => edge.from === selectedNode.id || edge.to === selectedNode.id) : []
  const relatedNodeIds = new Set(selectedEdges.flatMap((edge) => [edge.from, edge.to]))
  const selectedRelations = selectedNode ? positions.filter((node) => relatedNodeIds.has(node.id) && node.id !== selectedNode.id) : []
  const nodeState = (node: GraphNode) => {
    const selected = selectedNodeId === node.id
    const related = selectedNode ? relatedNodeIds.has(node.id) : false
    return {
      selected,
      related,
      dimmed: !!selectedNode && !related && !selected,
    }
  }
  const edgeState = (edge: GraphEdge) => {
    const from = resolvePoint(edge.from)
    const to = resolvePoint(edge.to)
    const selected = selectedNode ? selectedNode.id === from.id || selectedNode.id === to.id : false
    const related = selectedNode ? relatedNodeIds.has(from.id) && relatedNodeIds.has(to.id) : false
    return { from, to, selected, related, dimmed: !!selectedNode && !selected && !related }
  }

  const toggleSelectedNode = (nodeId: string) => {
    setSelectedNodeId((current) => (current === nodeId ? null : nodeId))
  }

  const edgePath = (from: GraphPoint, to: GraphPoint) => {
    const midX = (from.x + to.x) / 2
    // Smooth S-curve: horizontal tangent at both endpoints for organic neural feel.
    return `M ${from.x} ${from.y} C ${midX} ${from.y}, ${midX} ${to.y}, ${to.x} ${to.y}`
  }

  const resolvePoint = (value: string) => (value === 'hub' ? hub : positions.find((node) => node.id === value) ?? hub)

  const toGraphPoint = (event: ReactPointerEvent) => {
    const rect = graphStageRef.current?.getBoundingClientRect()
    if (!rect) return { x: 50, y: 50 }
    const x = ((event.clientX - rect.left - rect.width / 2) / zoom + rect.width / 2) / rect.width * 100
    const y = ((event.clientY - rect.top - rect.height / 2) / zoom + rect.height / 2) / rect.height * 100
    return { x: clampGraphPoint(x), y: clampGraphPoint(y) }
  }

  const handlePointerMove = (event: ReactPointerEvent) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const point = toGraphPoint(event)
    setNodePositions((current) => ({
      ...current,
      [drag.id]: { x: clampGraphPoint(point.x - drag.offsetX), y: clampGraphPoint(point.y - drag.offsetY) },
    }))
  }

  const endDrag = (event: ReactPointerEvent) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null
  }

  return (
    <div className="view-enter" style={{paddingTop: 16}}>
      <div className="page-hero">
        <div>
          <p className="eyebrow">Relationship graph</p>
          <h2>See how your brain map connects.</h2>
          <p>A compact relationship map keeps ideas, projects, tasks, and notes connected in a single workspace view.</p>
        </div>
      </div>
      <div className="graph-panel">
        <div className="section-header graph-header">
          <h2>Entity map</h2>
          <div className="graph-controls" aria-label="Graph controls">
            <button type="button" className="graph-control" onClick={() => updateZoom(zoom - 0.1)} aria-label="Zoom out">−</button>
            <button type="button" className="graph-control" onClick={() => updateZoom(0.86)} aria-label="Reset zoom">Reset</button>
            <button type="button" className="graph-control" onClick={() => updateZoom(zoom + 0.1)} aria-label="Zoom in">+</button>
            <button type="button" className="graph-control graph-control-secondary" onClick={resetLayout}>Auto-organize</button>
            <button type="button" className="graph-control graph-control-secondary" onClick={() => { const next = !showSidebar; setShowInspector(next); setShowList(next) }} aria-pressed={!showSidebar}>Focus map</button>
            <span className="count">{Math.round(zoom * 100)}%</span>
          </div>
        </div>
        <div className={`graph-layout ${showSidebar ? '' : 'sidebar-hidden'}`}>
          <div className={`graph-canvas graph-stage ${isRelayingOut ? 'is-relayingout' : ''}`} aria-label="Interactive relationship map" role="region" ref={graphStageRef} onPointerMove={handlePointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}>
            <div className="graph-grid" aria-hidden="true" />
            <div className="graph-scene" style={{ ['--graph-zoom']: `${zoom}` } as CSSProperties}>
              <svg className="graph-links" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                {hubEdges.map((edge) => {
                  const isSelected = selectedNode ? selectedNode.id === edge.to.id : false
                  return <path key={edge.id} d={edgePath(edge.from, edge.to)} className={`graph-link hub ${isSelected ? 'selected' : ''} ${selectedNode ? (!isSelected ? 'dimmed' : '') : ''}`} />
                })}
                {edges.map((edge) => {
                  const state = edgeState(edge)
                  return <path key={edge.id} d={edgePath(state.from, state.to)} className={`graph-link ${state.selected ? 'selected' : ''} ${state.related ? 'related' : ''} ${state.dimmed ? 'dimmed' : ''}`} style={{ ['--node-accent']: state.from.accent } as CSSProperties} />
                })}
              </svg>
              <div className="graph-hub" aria-hidden="true">
                <span className="graph-hub-label">Workspace hub</span>
                <strong>{nodes.length} connected items</strong>
                <small>Ideas, projects, tasks, and notes</small>
              </div>
              {nodes.length === 0 ? <p className="empty-state graph-empty">Create ideas, projects, tasks, or notes to populate the graph.</p> : null}
              {positions.map((node) => {
                const state = nodeState(node)
                return (
                  <button
                    key={node.id}
                    type="button"
                    className={`graph-node graph-node-${node.kind.toLowerCase()} ${state.selected ? 'selected' : ''} ${state.related ? 'related' : ''} ${state.dimmed ? 'dimmed' : ''}`}
                    style={{ left: `${node.x}%`, top: `${node.y}%`, ['--node-accent']: node.accent } as CSSProperties}
                    aria-pressed={state.selected}
                    aria-label={`${node.label}, ${node.kind}`}
                    onClick={() => toggleSelectedNode(node.id)}
                    onPointerDown={(event) => {
                      dragRef.current = {
                        id: node.id,
                        pointerId: event.pointerId,
                        offsetX: toGraphPoint(event).x - node.x,
                        offsetY: toGraphPoint(event).y - node.y,
                      }
                      if ('setPointerCapture' in event.currentTarget) event.currentTarget.setPointerCapture(event.pointerId)
                    }}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                  >
                    <span className="graph-node-kind">{node.kind}</span>
                    <strong>{node.label}</strong>
                    <small>{node.detail}</small>
                  </button>
                )
              })}
            </div>
          </div>
          {showSidebar ? (
            <aside className="graph-inspector" aria-label="Selected entity details">
              {showInspector ? (
                <section className="graph-detail-card">
                  <div className="section-header compact">
                    <h3>{selectedNode ? selectedNode.label : 'Select a node'}</h3>
                    <div className="graph-section-actions">
                      {selectedNode ? <span className="count">{selectedEdges.length} links</span> : null}
                      <button type="button" className="graph-control graph-control-secondary" onClick={() => setShowInspector(false)}>Collapse</button>
                    </div>
                  </div>
                  {selectedNode ? (
                    <>
                      <p className="graph-detail-kind">{selectedNode.kind}</p>
                      <p className="graph-detail-copy">
                        {selectedNode.kind === 'Idea' && 'A raw thought with full context.'}
                        {selectedNode.kind === 'Project' && 'A concrete lane where ideas turn into delivery.'}
                        {selectedNode.kind === 'Task' && 'An execution step tied to progress.'}
                        {selectedNode.kind === 'Note' && 'Captured context, links, and decisions.'}
                      </p>
                      <div className="graph-detail-links" aria-label="Related entities">
                        {selectedRelations.length > 0 ? selectedRelations.map((node) => (
                          <button key={node.id} type="button" className="graph-pill" onClick={() => toggleSelectedNode(node.id)}>
                            {node.label}
                          </button>
                        )) : <span className="graph-detail-empty">No direct links yet.</span>}
                      </div>
                    </>
                  ) : (
                    <p className="graph-detail-copy">Pick a node to inspect its links.</p>
                  )}
                </section>
              ) : (
                <button type="button" className="graph-collapsed-bar" onClick={() => setShowInspector(true)}>Show details</button>
              )}
              {showList ? (
                <section className="graph-detail-card">
                  <div className="section-header compact">
                    <h3>Accessible list</h3>
                    <div className="graph-section-actions">
                      <span className="count">Keyboard friendly</span>
                      <button type="button" className="graph-control graph-control-secondary" onClick={() => setShowList(false)}>Collapse</button>
                    </div>
                  </div>
                  <ul className="graph-list" aria-label="Entity list">
                    {nodes.map((node) => {
                      const state = nodeState(node)
                      return (
                        <li key={node.id}>
                          <button
                            type="button"
                            className={`graph-list-item ${state.selected ? 'selected' : ''} ${state.related ? 'related' : ''} ${state.dimmed ? 'dimmed' : ''}`}
                            aria-current={state.selected ? 'true' : undefined}
                            onClick={() => toggleSelectedNode(node.id)}
                          >
                            <span className="graph-list-kind">{node.kind}</span>
                            <strong>{node.label}</strong>
                            <small>{node.detail}</small>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </section>
              ) : (
                <button type="button" className="graph-collapsed-bar" onClick={() => setShowList(true)}>Show list</button>
              )}
            </aside>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function FocusView({ ideas, tasks, selectedProjectId, onMoveTask }: { ideas: Idea[]; tasks: Task[]; selectedProjectId?: string; onMoveTask: (id: string, columnId: TaskColumn) => Promise<void> }) {
  const projectTasks = selectedProjectId ? tasks.filter((task) => task.projectId === selectedProjectId) : tasks
  const openTasks = projectTasks.filter((task) => task.columnId !== 'done').slice(0, 8)
  const focusableIdeas = ideas.filter((idea) => idea.status !== 'done' && idea.status !== 'buried').slice(0, 8)
  const [linkedTarget, setLinkedTarget] = useState('')
  const [mode, setMode] = useState<'work' | 'short-break'>('work')
  const [durationMinutes, setDurationMinutes] = useState(25)
  const [remainingSeconds, setRemainingSeconds] = useState(25 * 60)
  const [isRunning, setIsRunning] = useState(false)
  const [completedSessions, setCompletedSessions] = useState(0)
  const targetOptions = useMemo(() => [
    ...openTasks.map((task) => ({ id: `task:${task.id}`, kind: 'Task' as const, label: task.title })),
    ...focusableIdeas.map((idea) => ({ id: `idea:${idea.id}`, kind: 'Idea' as const, label: idea.title })),
  ], [focusableIdeas, openTasks])
  const activeTarget = targetOptions.find((option) => option.id === linkedTarget) ?? targetOptions[0]

  useEffect(() => {
    if (!isRunning) return
    const timer = window.setInterval(() => {
      setRemainingSeconds((current) => {
        if (current <= 1) {
          window.clearInterval(timer)
          setIsRunning(false)
          setCompletedSessions((count) => count + 1)
          return 0
        }
        return current - 1
      })
    }, 1000)
    return () => window.clearInterval(timer)
  }, [isRunning])

  const totalSeconds = durationMinutes * 60
  const elapsedPct = totalSeconds > 0 ? Math.round(((totalSeconds - remainingSeconds) / totalSeconds) * 100) : 0
  const minutes = Math.floor(remainingSeconds / 60).toString().padStart(2, '0')
  const seconds = (remainingSeconds % 60).toString().padStart(2, '0')
  const activeTaskId = activeTarget?.id.startsWith('task:') ? activeTarget.id.slice(5) : null
  const activeTask = activeTaskId ? tasks.find((task) => task.id === activeTaskId) : null

  const resetSprint = (nextMode: 'work' | 'short-break', minutesValue: number) => {
    setMode(nextMode)
    setDurationMinutes(minutesValue)
    setRemainingSeconds(minutesValue * 60)
    setIsRunning(false)
  }

  return (
    <div className="view-enter" style={{paddingTop: 16}}>
      <div className="page-hero">
        <div>
          <p className="eyebrow">Daily focus</p>
          <h2>Spend your cognitive budget deliberately.</h2>
          <p>Focus Sprint links a timed work block to one Kanban task or idea, so the timer always belongs to real work.</p>
        </div>
      </div>
      <section className="focus-sprint-panel" aria-labelledby="focus-sprint-title">
        <div className="focus-sprint-copy">
          <p className="eyebrow">Focus Sprint</p>
          <h3 id="focus-sprint-title">A linked timer, not a floating stopwatch.</h3>
          <p>Pomodone is a product/brand name. The generic method is Pomodoro-style timeboxing; here it becomes a Focus Sprint tied to an OpenNapse entity.</p>
          <label className="settings-field">
            <span>Link this sprint to</span>
            <select value={linkedTarget} onChange={(event) => setLinkedTarget(event.target.value)} disabled={targetOptions.length === 0 || isRunning}>
              {targetOptions.length === 0 ? <option>No tasks or ideas available</option> : null}
              {targetOptions.map((option) => <option key={option.id} value={option.id}>{option.kind}: {option.label}</option>)}
            </select>
          </label>
          <div className="focus-sprint-modes" role="group" aria-label="Focus sprint mode">
            <button type="button" className={mode === 'work' && durationMinutes === 25 ? 'active' : ''} onClick={() => resetSprint('work', 25)}>25 min work</button>
            <button type="button" className={mode === 'work' && durationMinutes === 50 ? 'active' : ''} onClick={() => resetSprint('work', 50)}>50 min deep</button>
            <button type="button" className={mode === 'short-break' ? 'active' : ''} onClick={() => resetSprint('short-break', 5)}>5 min break</button>
          </div>
        </div>
        <div className="focus-timer-card" style={{ ['--focus-progress']: `${elapsedPct}%` } as CSSProperties}>
          <span className="focus-timer-mode">{mode === 'work' ? 'Work sprint' : 'Short break'}</span>
          <strong className="focus-timer-time" aria-live="polite">{minutes}:{seconds}</strong>
          <p>{activeTarget ? `${activeTarget.kind}: ${activeTarget.label}` : 'Pick a task or idea to start.'}</p>
          <div className="focus-timer-progress" aria-hidden="true"><span /></div>
          <div className="focus-timer-actions">
            <button type="button" className="btn btn-primary" disabled={!activeTarget} onClick={() => setIsRunning((running) => !running)}>{isRunning ? 'Pause' : 'Start'}</button>
            <button type="button" className="btn btn-secondary" onClick={() => resetSprint(mode, durationMinutes)}>Reset</button>
            {activeTask ? <button type="button" className="btn btn-ghost" onClick={() => void onMoveTask(activeTask.id, 'done')}>Complete task</button> : null}
          </div>
          <small>{completedSessions} sprint{completedSessions === 1 ? '' : 's'} completed this session</small>
        </div>
      </section>
      <div className="focus-grid" aria-label="Daily focus slots">
        {Array.from({ length: 5 }).map((_, index) => {
          const task = openTasks[index]
          return (
            <div className="focus-slot" key={index}>
              <span>Slot {index + 1}</span>
              {task ? (
                <>
                  <strong>{task.title}</strong>
                  <button type="button" onClick={() => void onMoveTask(task.id, 'done')}>Complete</button>
                </>
              ) : (
                <p>Available for rest or a future task</p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function StatsView({ ideas, projects, tasks, notes, exportData, importData, reload, onLoadDemoData, onClearAllData }: { ideas: Idea[]; projects: Project[]; tasks: Task[]; notes: Note[]; exportData: () => Promise<string>; importData: (payload: string) => Promise<void>; reload: () => Promise<void>; onLoadDemoData: () => Promise<void>; onClearAllData: () => Promise<void> }) {
  const stats = calculateStats(ideas, projects, tasks)
  const [backup, setBackup] = useState('')
  const [demoMessage, setDemoMessage] = useState('')
  return (
    <div className="view-enter" style={{paddingTop: 16}}>
      <div className="page-hero">
        <div>
          <p className="eyebrow">Momentum</p>
          <h2>Measure conversion from idea to reality.</h2>
          <p>Stats, export, and import are ready. Cloud backup is planned.</p>
        </div>
      </div>
      <div className="stats-grid" aria-label="Statistics">
        <div className="stat-card"><span>Ideas</span><strong>{stats.ideasCreated}</strong></div>
        <div className="stat-card"><span>Projects</span><strong>{stats.projectsCreated}</strong></div>
        <div className="stat-card"><span>Completed tasks</span><strong>{stats.tasksCompleted}</strong></div>
        <div className="stat-card"><span>Momentum</span><strong>{stats.momentumScore}</strong></div>
        <div className="stat-card"><span>Reality ratio</span><strong>{stats.ideaToRealityRatio}%</strong></div>
        <div className="stat-card"><span>Notes</span><strong>{notes.length}</strong></div>
      </div>
      <div className="backup-panel">
        <div className="section-header">
          <h2>Export / import JSON</h2>
        </div>
        <div className="backup-actions">
          <button className="btn btn-primary" type="button" onClick={() => void exportData().then(setBackup)}>Generate export</button>
          <button className="btn btn-secondary" type="button" onClick={() => { if (window.confirm('Import all data? This replaces every idea, project, task, and note with the content in the textarea above. This cannot be undone.')) void importData(backup).then(reload) }}>Import from text</button>
          <button className="btn btn-secondary" type="button" onClick={() => { if (window.confirm('Load demo data? This replaces all your existing ideas, projects, tasks, and notes with sample data. This cannot be undone.')) void onLoadDemoData().then(() => { setDemoMessage('Demo data loaded.'); reload() }).catch((err: unknown) => setDemoMessage(`Failed: ${err instanceof Error ? err.message : String(err)}`)) }}>Load demo data</button>
          <button className="btn btn-ghost" type="button" onClick={() => { if (window.confirm('Factory reset? This permanently deletes ALL your ideas, projects, tasks, and notes. This cannot be undone.')) void onClearAllData().then(() => { setDemoMessage('Factory reset complete.') }) }}>Factory reset</button>
        </div>
        {demoMessage ? <p className="settings-status">{demoMessage}</p> : null}
        <textarea aria-label="Backup JSON" value={backup} onChange={(event) => setBackup(event.target.value)} placeholder="Generated backup JSON appears here. Paste backup JSON here to import." />
      </div>
    </div>
  )
}

function AISuggestions({ ideas, projects, tasks }: { ideas: Idea[]; projects: Project[]; tasks: Task[] }) {
  return (
    <div className="ai-suggestions" aria-labelledby="ai-title">
      <div className="section-header">
        <h2 id="ai-title">Suggestions</h2>
      </div>
      <div className="ai-strip">
        {generateLocalAISuggestions(ideas, projects, tasks).map((item) => (
          <div className="ai-chip" key={item.title}>
            <Icon name="zap" />
            <div>
              <strong>{item.title}</strong>
              <span>{item.body}</span>
              <small>{item.action}</small>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

interface SpeechRecognitionLike {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((event: { resultIndex: number; results: Array<Array<{ transcript: string }>> }) => void) | null
  onerror: (() => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
}

function CaptureModal({ destinationName, onClose, onSubmit }: { destinationName: string; onClose: () => void; onSubmit: (input: { title: string; enhanceWithAI: boolean }) => Promise<void> }) {
  const [title, setTitle] = useState('')
  const [isListening, setIsListening] = useState(false)
  const [enhanceWithAI, setEnhanceWithAI] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)

  const sttSupported = useMemo(() => {
    return typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)
  }, [])

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop()
    setIsListening(false)
  }, [])

  const startListening = useCallback(() => {
    if (!sttSupported) return
    const win = window as unknown as { SpeechRecognition: new () => SpeechRecognitionLike; webkitSpeechRecognition: new () => SpeechRecognitionLike }
    const SpeechRecognition = win.SpeechRecognition || win.webkitSpeechRecognition
    const recognition = new SpeechRecognition()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = navigator.language || 'en-US'

    recognition.onresult = (event) => {
      let transcript = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript
      }
      setTitle((prev) => {
        const base = prev.trim()
        const suffix = transcript.trim()
        if (!base) return suffix
        if (!suffix) return base
        return base + ' ' + suffix
      })
    }

    recognition.onerror = () => {
      setIsListening(false)
    }

    recognition.onend = () => {
      setIsListening(false)
    }

    recognitionRef.current = recognition
    recognition.start()
    setIsListening(true)
  }, [sttSupported])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop()
    }
  }, [])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!title.trim() || submitting) return
    setSubmitting(true)
    try {
      await onSubmit({ title: title.trim(), enhanceWithAI })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <form className="brain-dump-modal promotion-modal" role="dialog" aria-modal="true" aria-labelledby="brain-dump-title" onSubmit={(event) => void handleSubmit(event)} onClick={e => e.stopPropagation()}>
        <div className="brain-dump-header">
          <h3 id="brain-dump-title">Brain Dump</h3>
          <button type="button" className="btn btn-ghost" onClick={onClose} style={{ fontSize: 12 }}>Cancel</button>
        </div>
        <div className="brain-dump-input">
          <label htmlFor="idea-title">What should not be lost?</label>
          <p className="brain-dump-destination">Saving to {destinationName}</p>
          <div className="brain-dump-input-wrap">
            <input
              id="idea-title"
              ref={inputRef}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="A raw idea, task, question, or spark..."
            />
            {sttSupported && (
              <button
                type="button"
                className={`brain-dump-mic${isListening ? ' listening' : ''}`}
                onClick={isListening ? stopListening : startListening}
                aria-label={isListening ? 'Stop listening' : 'Start voice input'}
                title={isListening ? 'Stop listening' : 'Start voice input'}
              >
                <Icon name="mic" />
              </button>
            )}
          </div>
          {isListening && <span className="brain-dump-listening">Listening…</span>}
        </div>
        <div className="brain-dump-footer">
          <label className="brain-dump-enhance">
            <input
              type="checkbox"
              checked={enhanceWithAI}
              onChange={(e) => setEnhanceWithAI(e.target.checked)}
            />
            Enhance with AI
          </label>
          <div className="modal-actions">
            <button className="btn btn-primary" type="submit" disabled={submitting}>Save locally</button>
          </div>
        </div>
      </form>
    </div>
  )
}

function CreateProjectModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (input: { title: string; description?: string; whyNow: string; firstStep: string; doneLooksLike: string }) => Promise<void> }) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [whyNow, setWhyNow] = useState('')
  const [firstStep, setFirstStep] = useState('')
  const [doneLooksLike, setDoneLooksLike] = useState('')
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    titleRef.current?.focus()
  }, [])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!title.trim() || !whyNow.trim() || !firstStep.trim() || !doneLooksLike.trim()) return
    await onSubmit({
      title: title.trim(),
      description: description.trim() || undefined,
      whyNow: whyNow.trim(),
      firstStep: firstStep.trim(),
      doneLooksLike: doneLooksLike.trim(),
    })
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <form className="brain-dump-modal" role="dialog" aria-modal="true" aria-labelledby="new-project-title" onSubmit={(event) => void handleSubmit(event)} onClick={(event) => event.stopPropagation()}>
        <div className="brain-dump-header">
          <h3 id="new-project-title">Create Folder</h3>
          <button type="button" className="btn btn-ghost" onClick={onClose} style={{ fontSize: 12 }}>Cancel</button>
        </div>
        <div className="brain-dump-input promotion-fields">
          <div className="form-group promotion-field">
            <label htmlFor="project-title">Folder name</label>
            <input id="project-title" type="text" ref={titleRef} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Project or folder name" />
          </div>
          <div className="form-group promotion-field">
            <label htmlFor="project-description">Short description</label>
            <input id="project-description" type="text" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Optional description" />
          </div>
          <div className="form-group promotion-field">
            <label htmlFor="project-why">Why now?</label>
            <input id="project-why" type="text" value={whyNow} onChange={(event) => setWhyNow(event.target.value)} placeholder="Why is this worth starting now?" />
          </div>
          <div className="form-group promotion-field">
            <label htmlFor="project-step">First concrete step</label>
            <input id="project-step" type="text" value={firstStep} onChange={(event) => setFirstStep(event.target.value)} placeholder="First concrete step" />
          </div>
          <div className="form-group promotion-field">
            <label htmlFor="project-done">Done looks like</label>
            <input id="project-done" type="text" value={doneLooksLike} onChange={(event) => setDoneLooksLike(event.target.value)} placeholder="Done looks like..." />
          </div>
        </div>
        <div className="brain-dump-footer">
          <span className="brain-dump-hint">Create a new folder for focused work.</span>
          <div className="modal-actions">
            <button className="btn btn-primary" type="submit">Create folder</button>
          </div>
        </div>
      </form>
    </div>
  )
}

function PromotionModal({ idea, onClose, onSubmit }: {
  idea: Idea
  onClose: () => void
  onSubmit: (input: { whyNow: string; firstStep: string; doneLooksLike: string }) => Promise<void>
}) {
  const [whyNow, setWhyNow] = useState('')
  const [firstStep, setFirstStep] = useState('')
  const [doneLooksLike, setDoneLooksLike] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!whyNow.trim() || !firstStep.trim() || !doneLooksLike.trim()) return
    await onSubmit({ whyNow: whyNow.trim(), firstStep: firstStep.trim(), doneLooksLike: doneLooksLike.trim() })
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <form className="brain-dump-modal" role="dialog" aria-modal="true" aria-labelledby="promotion-title" onSubmit={(event) => void handleSubmit(event)} onClick={e => e.stopPropagation()}>
        <div className="brain-dump-header">
          <h3 id="promotion-title">Promote Idea</h3>
          <button type="button" className="btn btn-ghost" onClick={onClose} style={{ fontSize: 12 }}>Cancel</button>
        </div>
        <div className="brain-dump-input promotion-fields">
          <div className="form-group promotion-field">
            <label htmlFor="why-now">Promote “{idea.title}”</label>
            <input id="why-now" type="text" ref={inputRef} value={whyNow} onChange={(event) => setWhyNow(event.target.value)} placeholder="Why now?" />
          </div>
          <div className="form-group promotion-field">
            <label htmlFor="first-step">First concrete step</label>
            <input id="first-step" type="text" value={firstStep} onChange={(event) => setFirstStep(event.target.value)} placeholder="First concrete step" />
          </div>
          <div className="form-group promotion-field">
            <label htmlFor="done-looks-like">Done looks like</label>
            <input id="done-looks-like" type="text" value={doneLooksLike} onChange={(event) => setDoneLooksLike(event.target.value)} placeholder="Done looks like..." />
          </div>
        </div>
        <div className="brain-dump-footer">
          <span className="brain-dump-hint">Create a solid foundation</span>
          <div className="modal-actions">
            <button className="btn btn-primary" type="submit">Create project</button>
          </div>
        </div>
      </form>
    </div>
  )
}

function NavRail({ activeTab, onTabChange, ideaCount, theme, onToggleTheme, onOpenSettings }: { activeTab: ViewId; onTabChange: (view: ViewId) => void; ideaCount: number; theme: ThemeMode; onToggleTheme: () => void; onOpenSettings: () => void }) {
  return (
    <nav className="nav-rail" role="navigation" aria-label="Main navigation">
      <div className="nav-rail-logo" title="OpenNapse">ON</div>
      <div className="nav-rail-items">
        {views.map(tab => (
          <button
            key={tab.id}
            className={`nav-rail-item ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => onTabChange(tab.id)}
            title={tab.label}
            aria-label={tab.label}
            aria-current={activeTab === tab.id ? 'page' : undefined}
          >
            <Icon name={tab.icon} />
            {tab.id === 'capture' && ideaCount > 0 && (
              <span className="nav-rail-badge">{ideaCount}</span>
            )}
          </button>
        ))}
      </div>
      <div className="nav-rail-bottom">
        <button className="nav-rail-item" title="Settings" aria-label="Settings" onClick={onOpenSettings}>
          <Icon name="settings" />
        </button>
        <button className="nav-rail-item" title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} aria-label="Toggle theme" aria-pressed={theme === 'dark'} onClick={onToggleTheme}>
          <Icon name="moon" />
        </button>
      </div>
    </nav>
  )
}

function Sidebar({ sidebarTab, onSidebarTabChange, searchQuery, onSearchChange, projectsCount, projects, ideas, tags, activeFilter, onSelectFilter, onMoveIdeaToProject, ideaDropEnabled, rootRef }: { 
  sidebarTab: 'folders' | 'tags'; 
  onSidebarTabChange: (tab: 'folders'|'tags') => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  projectsCount: number;
  projects: Project[];
  ideas: Idea[];
  tags: { tag: string; count: number }[];
  activeFilter: SidebarFilter;
  onSelectFilter: (filter: SidebarFilter) => void;
  onMoveIdeaToProject: (ideaId: string, projectId: string) => Promise<void>;
  ideaDropEnabled: boolean;
  rootRef?: Ref<HTMLElement>;
}) {
  const [dragOverProjectId, setDragOverProjectId] = useState<string | null>(null)

  function canDropIdea(event: ReactDragEvent) {
    return ideaDropEnabled && hasIdeaDragPayload(event.dataTransfer)
  }

  function handleProjectDragOver(event: ReactDragEvent, projectId: string) {
    if (!canDropIdea(event)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setDragOverProjectId(projectId)
  }

  function handleProjectDrop(event: ReactDragEvent, projectId: string) {
    if (!ideaDropEnabled || !hasIdeaDragPayload(event.dataTransfer)) return
    event.preventDefault()
    setDragOverProjectId(null)
    const payload = readIdeaDragPayload(event.dataTransfer)
    const idea = payload ? ideas.find((item) => item.id === payload.ideaId) : undefined
    if (!payload || !idea || idea.projectId === projectId) return
    void onMoveIdeaToProject(payload.ideaId, projectId)
  }

  return (
    <aside ref={rootRef} id="app-sidebar" className="sidebar" role="complementary" aria-label="Sidebar navigation">
      <div className="sidebar-search">
        <Icon name="search" />
        <input 
          type="text" 
          placeholder="Search ideas..." 
          aria-label="Search ideas" 
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>
      <div className="sidebar-tabs" role="tablist">
        <button
          className={`sidebar-tab ${sidebarTab === 'folders' ? 'active' : ''}`}
          onClick={() => onSidebarTabChange('folders')}
          role="tab"
          aria-selected={sidebarTab === 'folders'}
        >
          Folders
        </button>
        <button
          className={`sidebar-tab ${sidebarTab === 'tags' ? 'active' : ''}`}
          onClick={() => onSidebarTabChange('tags')}
          role="tab"
          aria-selected={sidebarTab === 'tags'}
        >
          Tags
        </button>
      </div>
      <div className="sidebar-tree" role="tree" aria-label={sidebarTab === 'folders' ? 'Project folders' : 'Workspace tags'}>
        {sidebarTab === 'folders' ? (
          <>
            <div className="tree-section tree-section-row" aria-hidden="true">
              <span>Projects</span>
              <span className="tree-item-count">{projectsCount}</span>
            </div>
            <button
              className={`tree-item tree-item-all ${activeFilter.kind === 'all' ? 'active' : ''}`}
              role="treeitem"
              aria-level={1}
              aria-selected={activeFilter.kind === 'all'}
              onClick={() => onSelectFilter({ kind: 'all' })}
            >
              <Icon name="grid" />
              <span>All</span>
            </button>
            {projects.length === 0 ? <p className="tree-empty">No projects yet</p> : null}
            {projects.map((project) => {
              const isActive = activeFilter.kind === 'project' && activeFilter.projectId === project.id
              const isDropTarget = dragOverProjectId === project.id
              return (
                <button
                  key={project.id}
                  className={`tree-item ${isActive ? 'active' : ''} ${isDropTarget ? 'drop-over' : ''}`}
                  role="treeitem"
                  aria-level={1}
                  aria-selected={isActive}
                  onClick={() => onSelectFilter({ kind: 'project', projectId: project.id })}
                  onDragEnter={(event) => handleProjectDragOver(event, project.id)}
                  onDragOver={(event) => handleProjectDragOver(event, project.id)}
                  onDragLeave={() => setDragOverProjectId((current) => (current === project.id ? null : current))}
                  onDrop={(event) => handleProjectDrop(event, project.id)}
                >
                  <Icon name="folder" />
                  <span>{project.title}</span>
                </button>
              )
            })}
          </>
        ) : (
          <>
            <div className="tree-section">All Tags</div>
            {tags.length === 0 ? <p className="tree-empty">No tags yet</p> : null}
            {tags.map(({ tag, count }) => (
              <button key={tag} className={`tree-item ${activeFilter.kind === 'tag' && activeFilter.tag === tag ? 'active' : ''}`} role="treeitem" aria-level={1} aria-selected={activeFilter.kind === 'tag' && activeFilter.tag === tag} onClick={() => onSelectFilter({ kind: 'tag', tag })}>
                <Icon name="tag" />
                <span>{tag}</span>
                <span className="tree-item-count">{count}</span>
              </button>
            ))}
          </>
        )}
      </div>
    </aside>
  )
}

function CommandPalette({ onClose, onCapture, onNewNote, onFocusSearch, onGoToView, onEnterFlow }: { onClose: () => void; onCapture: () => void; onNewNote: () => void; onFocusSearch: () => void; onGoToView: (view: ViewId) => void; onEnterFlow: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const commands = [
    { icon: 'lightbulb' as IconName, title: 'New Idea', subtitle: 'Capture a new idea', shortcut: 'Space', action: onCapture },
    { icon: 'fileText' as IconName, title: 'New Note', subtitle: 'Open the local note editor', shortcut: '⌘N', action: onNewNote },
    { icon: 'search' as IconName, title: 'Search Everything', subtitle: 'Focus the workspace search', shortcut: '⌘F', action: onFocusSearch },
    { icon: 'columns' as IconName, title: 'Go to Kanban', subtitle: 'Open the project board', shortcut: '⌘2', action: () => onGoToView('kanban') },
    { icon: 'target' as IconName, title: 'Enter Flow Mode', subtitle: 'Hide side chrome and focus', shortcut: '⌘⇧F', action: onEnterFlow },
    { icon: 'barChart' as IconName, title: 'Open Stats', subtitle: 'Review momentum and backups', shortcut: '⌘7', action: () => onGoToView('stats') },
  ]

  const filtered = query
    ? commands.filter(c => c.title.toLowerCase().includes(query.toLowerCase()) || c.subtitle.toLowerCase().includes(query.toLowerCase()))
    : commands

  function runCommand(index: number) {
    filtered[index]?.action()
  }

  return (
    <div className="command-palette-overlay" onClick={onClose}>
      <div className="command-palette" role="dialog" aria-modal="true" aria-label="Command palette" onClick={e => e.stopPropagation()}>
        <div className="command-palette-input">
          <Icon name="search" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search commands, files, ideas..."
            value={query}
            role="combobox"
            aria-expanded="true"
            aria-controls="command-palette-results"
            onChange={e => {
              setQuery(e.target.value)
              setSelectedIndex(0)
            }}
            aria-activedescendant={`cmd-${selectedIndex}`}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setSelectedIndex((current) => Math.min(current + 1, filtered.length - 1))
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault()
                setSelectedIndex((current) => Math.max(current - 1, 0))
              }
              if (event.key === 'Enter') {
                event.preventDefault()
                runCommand(selectedIndex)
              }
              if (event.key === 'Escape') onClose()
            }}
          />
        </div>
        <div className="command-palette-results" id="command-palette-results" role="listbox" aria-label="Commands">
          {filtered.map((cmd, i) => (
            <div key={cmd.title} id={`cmd-${i}`} role="option" aria-selected={i === selectedIndex} className={`command-result ${i === selectedIndex ? 'active' : ''}`} onMouseEnter={() => setSelectedIndex(i)} onClick={() => runCommand(i)}>
              <div className="command-result-icon"><Icon name={cmd.icon} /></div>
              <div className="command-result-text">
                <div className="command-result-title">{cmd.title}</div>
                <div className="command-result-subtitle">{cmd.subtitle}</div>
              </div>
              <span className="command-result-shortcut">{cmd.shortcut}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function MentorPanel({
  isOpen,
  sessions,
  activeSessionId,
  onSelectSession,
  onNewSession,
  onSendMessage,
  onClearSessions,
}: {
  isOpen: boolean
  sessions: MentorSession[]
  activeSessionId: string | null
  onSelectSession: (id: string | null) => void
  onNewSession: () => void
  onSendMessage: (message: string) => void
  onClearSessions: () => void
}) {
  const [message, setMessage] = useState('')
  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? sessions[0]

  useEffect(() => {
    if (!activeSession && sessions.length > 0) onSelectSession(sessions[0].id)
  }, [activeSession, sessions, onSelectSession])

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!message.trim()) return
    onSendMessage(message.trim())
    setMessage('')
  }

  return (
    <aside className={`mentor-panel${isOpen ? ' open' : ''}`} aria-label="Mentor assistant" role="complementary" data-open={isOpen}>
      <div className="mentor-header">
        <div>
          <p className="eyebrow">Assistant</p>
          <h3>Mentor</h3>
          <span className="mentor-status">Local session</span>
        </div>
        <div className="mentor-actions">
          <button className="btn btn-ghost" type="button" onClick={onNewSession} title="New session">New</button>
          <button className="btn btn-ghost" type="button" onClick={onClearSessions} title="Clear all">Clear</button>
        </div>
      </div>
      <div className="mentor-body">
        <div className="mentor-sessions">
          {sessions.length === 0 ? (
            <div className="mentor-empty">
              <p>No sessions yet.</p>
              <button className="btn btn-secondary" type="button" onClick={onNewSession}>Start a session</button>
            </div>
          ) : (
            sessions.map((session) => (
              <button
                key={session.id}
                className={`mentor-session ${activeSession?.id === session.id ? 'active' : ''}`}
                type="button"
                onClick={() => onSelectSession(session.id)}
              >
                <strong>{session.title}</strong>
                <span>{new Date(session.updatedAt).toLocaleString()}</span>
              </button>
            ))
          )}
        </div>
        <div className="mentor-chat">
          {activeSession ? (
            <div className="mentor-messages">
              {activeSession.messages.map((msg) => (
                <div key={msg.id} className={`mentor-message ${msg.role}`}>
                  <span>{msg.content}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="mentor-messages mentor-empty-state">
              <p>Mentor is ready when you are.</p>
            </div>
          )}
          <form className="mentor-input" onSubmit={handleSubmit}>
            <input
              type="text"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Ask Mentor about your projects..."
              aria-label="Mentor message"
            />
            <button className="btn btn-primary" type="submit">Send</button>
          </form>
        </div>
      </div>
    </aside>
  )
}






function StatusDock({ isOpen, onClose, authStatus, workspaceBootstrap, sync, ideasCount, projectsCount, tasksCount, notesCount, activeWorkspace }: {
  isOpen: boolean
  onClose: () => void
  authStatus: AuthStatus
  workspaceBootstrap: PersonalWorkspaceBootstrapStatus
  sync: { label: string; description: string; status: string }
  ideasCount: number
  projectsCount: number
  tasksCount: number
  notesCount: number
  activeWorkspace: ActiveWorkspace
}) {
  const authColor = authStatus.mode === 'signed-in' ? 'green' : authStatus.mode === 'loading' ? 'yellow' : 'gray'
  const bootstrapColor = workspaceBootstrap.mode === 'ready' ? 'green' : workspaceBootstrap.mode === 'failed' ? 'red' : workspaceBootstrap.mode === 'bootstrapping' ? 'yellow' : 'gray'
  const syncColor = sync.status === 'synced' ? 'green' : sync.status === 'offline' ? 'red' : sync.status === 'syncing' ? 'yellow' : 'gray'
  return (
    <aside className={`status-dock${isOpen ? ' open' : ''}`}>
      <div className="status-dock-header">
        <h3>Status</h3>
        <button type="button" className="btn btn-ghost" onClick={onClose} aria-label="Close status dock">
          <Icon name="chevronRight" />
        </button>
      </div>
      <div className="status-dock-body">
        <div className="status-dock-section">
          <p className="status-dock-section-title">Account</p>
          <div className="status-dock-row">
            <span className="status-dock-row-label">Status</span>
            <div className="status-dock-row-value" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className={`status-dot status-dot--${authColor}`} />
              {authStatus.label}
            </div>
          </div>
          {authStatus.mode === 'signed-in' ? (
            <div className="status-dock-row">
              <span className="status-dock-row-label">Email</span>
              <span className="status-dock-row-value">{authStatus.email ?? '—'}</span>
            </div>
          ) : null}
        </div>
        <div className="status-dock-section">
          <p className="status-dock-section-title">Workspace</p>
          <div className="status-dock-row">
            <span className="status-dock-row-label">Name</span>
            <span className="status-dock-row-value">{activeWorkspace.name}</span>
          </div>
          <div className="status-dock-row">
            <span className="status-dock-row-label">Mode</span>
            <span className="status-dock-row-value">{activeWorkspace.badge}</span>
          </div>
          <div className="status-dock-row">
            <span className="status-dock-row-label">Bootstrap</span>
            <div className="status-dock-row-value" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className={`status-dot status-dot--${bootstrapColor}`} />
              {workspaceBootstrap.mode === 'ready' ? 'Ready' : workspaceBootstrap.mode === 'failed' ? 'Failed' : workspaceBootstrap.mode === 'bootstrapping' ? 'Connecting' : 'Idle'}
            </div>
          </div>
          {workspaceBootstrap.mode === 'failed' ? (
            <p style={{ fontSize: 12, color: 'var(--muted)', margin: '2px 0 0' }}>{workspaceBootstrap.description}</p>
          ) : null}
        </div>
        <div className="status-dock-section">
          <p className="status-dock-section-title">Sync</p>
          <div className="status-dock-row">
            <span className="status-dock-row-label">Connection</span>
            <div className="status-dock-row-value" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className={`status-dot status-dot--${syncColor}`} />
              {sync.label}
            </div>
          </div>
          <p style={{ fontSize: 12, color: 'var(--muted)', margin: '2px 0 0' }}>{sync.description}</p>
        </div>
        <div className="status-dock-section">
          <p className="status-dock-section-title">Storage</p>
          <div className="status-dock-row">
            <span className="status-dock-row-label">Ideas</span>
            <span className="status-dock-row-value">{ideasCount}</span>
          </div>
          <div className="status-dock-row">
            <span className="status-dock-row-label">Projects</span>
            <span className="status-dock-row-value">{projectsCount}</span>
          </div>
          <div className="status-dock-row">
            <span className="status-dock-row-label">Tasks</span>
            <span className="status-dock-row-value">{tasksCount}</span>
          </div>
          <div className="status-dock-row">
            <span className="status-dock-row-label">Notes</span>
            <span className="status-dock-row-value">{notesCount}</span>
          </div>
        </div>
      </div>
    </aside>
  )
}


function LogViewer() {
  const [logs, setLogs] = useState<LogEntry[]>(getLogs)
  const [filter, setFilter] = useState<LogLevel | 'all'>('all')

  useEffect(() => {
    const unsub = subscribeLogs(() => {
      setLogs(getLogs())
    })
    return unsub
  }, [])

  const filtered = logs.filter((entry) => filter === 'all' || entry.level === filter)

  return (
    <div className="log-viewer">
      <div className="log-viewer-header">
        <h2>Logs</h2>
        <div className="log-viewer-controls">
          <select className="log-filter" value={filter} onChange={(e) => setFilter(e.target.value as LogLevel | 'all')}>
            <option value="all">All</option>
            <option value="error">Errors</option>
            <option value="warn">Warnings</option>
            <option value="info">Info</option>
            <option value="debug">Debug</option>
          </select>
          <button className="btn btn-secondary btn-compact" onClick={() => { clearLogs(); setLogs([]) }}>Clear</button>
          <button className="btn btn-secondary btn-compact" onClick={() => { const blob = new Blob([serializeLogs()], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'opennapse-logs.json'; a.click() }}>Export</button>
        </div>
      </div>
      <div className="log-viewer-list">
        {filtered.length === 0 ? (
          <p className="empty-state" style={{ padding: '40px 16px', margin: 0 }}>No log entries.</p>
        ) : (
          filtered.map((entry) => (
            <div key={entry.id} className={`log-entry log-entry--${entry.level}`}>
              <span className="log-entry-time">{new Date(entry.timestamp).toLocaleTimeString()}</span>
              <span className={`log-entry-level log-entry-level--${entry.level}`}>{entry.level.toUpperCase()}</span>
              <span className="log-entry-source">{entry.source}</span>
              <span className="log-entry-message">{entry.message}</span>
              {entry.data ? <span className="log-entry-data">{JSON.stringify(entry.data)}</span> : null}
            </div>
          ))
        )}
      </div>
    </div>
  )
}


function SettingsModal({ theme, onThemeChange, activeWorkspace, workspaceMode, onWorkspaceModeChange, supabaseEnv, authStatus, workspaceBootstrap, aiSettings, onAISettingsChange, sessionKeys, onSessionKeyChange, acceptedPreviewHash, onAcceptPreview, settingsSavedAt, onClearData, onClose }: {
  theme: ThemeMode
  onThemeChange: (theme: ThemeMode) => void
  activeWorkspace: ActiveWorkspace
  workspaceMode: WorkspaceMode
  onWorkspaceModeChange: (mode: WorkspaceMode) => void
  supabaseEnv: ResolvedSupabaseEnv
  authStatus: AuthStatus
  workspaceBootstrap: PersonalWorkspaceBootstrapStatus
  aiSettings: AISettings
  onAISettingsChange: (settings: AISettings) => void
  sessionKeys: Record<string, string>
  onSessionKeyChange: (providerId: string, value: string) => void
  acceptedPreviewHash?: string
  onAcceptPreview: (hash: string | undefined) => void
  settingsSavedAt: string | null
  onClearData: () => Promise<void>
  onClose: () => void
}) {
  const [statusMessage, setStatusMessage] = useState('')
  const [authEmail, setAuthEmail] = useState('')
  const [authActionMessage, setAuthActionMessage] = useState('')
  const [clearDataMessage, setClearDataMessage] = useState('')
  const [connectionResult, setConnectionResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [displayNameSavedAt, setDisplayNameSavedAt] = useState<string | null>(null)
  const [displayNameError, setDisplayNameError] = useState('')
  const [isTesting, setIsTesting] = useState(false)
  const [liveModels, setLiveModels] = useState<ListedModel[] | null>(null)
  const [modelsLoading, setModelsLoading] = useState(false)
  const [keyVisible, setKeyVisible] = useState(false)

  useEffect(() => {
    if (authStatus.mode !== 'signed-in') { setDisplayName(''); return }
    void fetchProfile().then((profile) => {
      if (profile) setDisplayName(profile.display_name)
    })
  }, [authStatus.mode])

  async function saveDisplayName(name: string) {
    setDisplayNameError('')
    const result = await updateDisplayName(name)
    if (result.ok) {
      setDisplayNameSavedAt(new Date().toISOString())
    } else {
      setDisplayNameError(result.error)
    }
  }

  const activeProviderId = aiSettings.activeProviderId
  const activeProviderDef = AI_PROVIDERS[activeProviderId]
  const isHostedActive = activeProviderDef.hosted
  const isOllamaActive = activeProviderId === 'ollama-cloud'
  const isGenericHostedActive = isHostedActive && !isOllamaActive
  type HostedProviderKey = 'openai' | 'anthropic' | 'openrouter' | 'mistral' | 'deepseek' | 'groq'
  const hostedProviderConfig = isGenericHostedActive
    ? aiSettings.providers[activeProviderId as HostedProviderKey]
    : undefined
  const activeModelId = isOllamaActive
    ? aiSettings.ollamaCloud.model
    : isGenericHostedActive
      ? hostedProviderConfig!.modelId
      : 'rules-v1'
  const activeBaseUrlOverride = hostedProviderConfig?.baseUrl
  const sessionKey = sessionKeys[activeProviderId] ?? ''
  const preview = useMemo<AIRequestPreview>(() => {
    if (activeProviderId === 'local-rules') {
      return buildOllamaCloudPreview('connection-test')
    }
    return (
      buildProviderPreview({
        providerId: activeProviderId,
        actionType: 'connection-test',
        modelId: activeModelId,
        baseUrl: activeBaseUrlOverride,
      }) ?? buildOllamaCloudPreview('connection-test')
    )
  }, [activeProviderId, activeModelId, activeBaseUrlOverride])
  const billingEnv = useMemo(() => getBillingEnv(), [])
  const isHosted = billingEnv.configured
  const [settingsTab, setSettingsTab] = useState<'account' | 'ai' | 'data' | 'billing' | 'advanced'>('account')
  const statusToShow = statusMessage
  const canRequestMagicLink = supabaseEnv.configured && authStatus.mode !== 'loading' && authStatus.mode !== 'signed-in' && authEmail.trim().length > 0

  function updateProvider(providerId: AISettings['activeProviderId']) {
    onAISettingsChange({ ...aiSettings, activeProviderId: providerId })
    setConnectionResult(null)
    setLiveModels(null)
    setKeyVisible(false)
  }

  function updateHostedConsent(enabled: boolean) {
    if (isOllamaActive) {
      onAISettingsChange({
        ...aiSettings,
        ollamaCloud: {
          ...aiSettings.ollamaCloud,
          hostedConsentAccepted: enabled,
          hostedConsentAcceptedAt: enabled ? new Date().toISOString() : undefined,
        },
      })
      return
    }
    if (!isGenericHostedActive) return
    const key = activeProviderId as HostedProviderKey
    onAISettingsChange({
      ...aiSettings,
      providers: {
        ...aiSettings.providers,
        [key]: {
          ...aiSettings.providers[key],
          hostedConsentAccepted: enabled,
          hostedConsentAcceptedAt: enabled ? new Date().toISOString() : undefined,
        },
      },
    })
  }

  function updateHostedModel(modelId: string) {
    if (!isGenericHostedActive) return
    const key = activeProviderId as HostedProviderKey
    onAISettingsChange({
      ...aiSettings,
      providers: {
        ...aiSettings.providers,
        [key]: { ...aiSettings.providers[key], modelId },
      },
    })
  }

  function updateHostedBaseUrl(baseUrl: string) {
    if (!isGenericHostedActive) return
    const key = activeProviderId as HostedProviderKey
    const trimmed = baseUrl.trim()
    onAISettingsChange({
      ...aiSettings,
      providers: {
        ...aiSettings.providers,
        [key]: { ...aiSettings.providers[key], baseUrl: trimmed || undefined },
      },
    })
  }

  async function handleTestConnection() {
    if (!sessionKey.trim()) return
    setIsTesting(true)
    setConnectionResult(null)
    setLiveModels(null)
    try {
      const result = await testProviderConnection(sessionKey, activeProviderId, activeBaseUrlOverride)
      setConnectionResult({ ok: result.ok, message: result.ok ? result.provider : result.error })
      if (result.ok) {
        fetchLiveModels()
      }
    } catch (err) {
      setConnectionResult({ ok: false, message: err instanceof Error ? err.message : 'Unknown error' })
    } finally {
      setIsTesting(false)
    }
  }

  async function fetchLiveModels() {
    setModelsLoading(true)
    const result = await listProviderModels(sessionKey, activeProviderId, activeBaseUrlOverride)
    if (result.ok) {
      setLiveModels(result.models)
      const liveIds = new Set(result.models.map((m) => m.id))
      if (activeModelId && !liveIds.has(activeModelId)) {
        if (isGenericHostedActive) {
          updateHostedModel(result.models[0]!.id)
        }
      }
    }
    setModelsLoading(false)
  }

  const modelOptions = liveModels ?? activeProviderDef.models
  const showCuratedFallbackHint = !liveModels && connectionResult?.ok

  const consentAccepted = isOllamaActive
    ? aiSettings.ollamaCloud.hostedConsentAccepted
    : isGenericHostedActive
      ? hostedProviderConfig!.hostedConsentAccepted
      : false

  const consentHelp = isOllamaActive
    ? 'I understand Ollama Cloud sends selected context to an external hosted provider.'
    : isGenericHostedActive
      ? `I understand ${activeProviderDef.label} sends selected context to an external hosted provider.`
      : 'Local rules do not require consent.'

  const sessionKeyLabel = isOllamaActive
    ? 'Ollama Cloud API key (session only)'
    : isGenericHostedActive
      ? `${activeProviderDef.label} API key (session only)`
      : ''

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title" onClick={(event) => event.stopPropagation()}>
        <div className="brain-dump-header">
          <div>
            <p className="eyebrow">Preferences</p>
            <h3 id="settings-title">Settings</h3>
          </div>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>

        <div className="settings-tabs">
          <button type="button" className={settingsTab === 'account' ? 'active' : ''} onClick={() => setSettingsTab('account')}>Account</button>
          <button type="button" className={settingsTab === 'ai' ? 'active' : ''} onClick={() => setSettingsTab('ai')}>AI</button>
          <button type="button" className={settingsTab === 'data' ? 'active' : ''} onClick={() => setSettingsTab('data')}>Data</button>
          {isHosted ? (
            <button type="button" className={settingsTab === 'billing' ? 'active' : ''} onClick={() => setSettingsTab('billing')}>Billing</button>
          ) : (
            <button type="button" className={settingsTab === 'advanced' ? 'active' : ''} onClick={() => setSettingsTab('advanced')}>Advanced</button>
          )}
        </div>
        <div className="settings-tab-content">
          {settingsTab === 'account' && (
            <div className="settings-grid">
              <section className="settings-panel" aria-labelledby="profile-settings-title">
                <h4 id="profile-settings-title">Profile</h4>
                {authStatus.mode === 'signed-in' ? (
                  <>
                    <label className="settings-field">
                      <span>Display name</span>
                      <input
                        type="text"
                        value={displayName}
                        onChange={(event) => setDisplayName(event.target.value)}
                        onBlur={() => {
                          if (displayName.trim()) void saveDisplayName(displayName)
                        }}
                        placeholder="Your name"
                      />
                    </label>
                    <div className="settings-row"><span>Email</span><strong>{authStatus.email ?? 'Unknown'}</strong></div>
                    {displayNameSavedAt ? <p className="settings-status">Display name saved.</p> : null}
                    {displayNameError ? <p className="settings-status settings-status--error">{displayNameError}</p> : null}
                    <div className="settings-actions">
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={async () => {
                          logger.info('auth', 'Signing out')
                          const result = await signOutOfSupabase()
                          logger.info('auth', `Sign out: ${result.message}`)
                          setAuthActionMessage(result.message)
                        }}
                      >Sign out</button>
                    </div>
                  </>
                ) : (
                  <>
                    <label className="settings-field">
                      <span>Email for magic link</span>
                      <input
                        type="email"
                        value={authEmail}
                        onChange={(event) => setAuthEmail(event.target.value)}
                        placeholder="you@example.com"
                        disabled={!supabaseEnv.configured}
                      />
                    </label>
                    {!isHosted ? (
                      <p className="settings-muted">Magic link sign-in is only available with a Supabase backend configured.</p>
                    ) : null}
                    <div className="settings-actions">
                      <button
                        type="button"
                        className="btn btn-secondary"
                        disabled={!canRequestMagicLink}
                          onClick={async () => {
                            logger.info('auth', 'Requesting magic link', { email: authEmail })
                            const result = await requestMagicLink(authEmail)
                            logger.info('auth', `Magic link: ${result.message}`)
                            setAuthActionMessage(result.message)
                          }}
                      >Send magic link</button>
                    </div>
                  </>
                )}
                {authActionMessage ? <p className="settings-status">{authActionMessage}</p> : null}
              </section>

              <section className="settings-panel" aria-labelledby="appearance-settings-title">
                <h4 id="appearance-settings-title">Appearance</h4>
                <div className="settings-row">
                  <span>Theme</span>
                  <div className="segmented-control" role="group" aria-label="Theme">
                    <button type="button" className={theme === 'light' ? 'active' : ''} onClick={() => onThemeChange('light')}>Light</button>
                    <button type="button" className={theme === 'dark' ? 'active' : ''} onClick={() => onThemeChange('dark')}>Dark</button>
                  </div>
                </div>
                <div className="settings-row"><span>Motion</span><strong>Respects OS reduced motion</strong></div>
                <div className="settings-row"><span>Text scale</span><strong>Comfort 15px base</strong></div>
              </section>

              <section className="settings-panel" aria-labelledby="security-settings-title">
                <h4 id="security-settings-title">Privacy and security</h4>
                <ul className="settings-list">
                  <li>No telemetry by default.</li>
                  <li>Hosted API keys are session-only and never saved to localStorage.</li>
                  <li>Hosted requests require consent and exact preview acceptance.</li>
                </ul>
              </section>
            </div>
          )}

          {settingsTab === 'ai' && (
            <div className="settings-grid">
              <section className="settings-panel" aria-labelledby="ai-settings-title">
                <h4 id="ai-settings-title">AI providers</h4>
                <label className="settings-field">
                  <span>Provider</span>
                  <select value={activeProviderId} onChange={(event) => updateProvider(event.target.value as AISettings['activeProviderId'])}>
                    {Object.values(AI_PROVIDERS).map((provider) => (
                      <option key={provider.id} value={provider.id}>{provider.label}</option>
                    ))}
                  </select>
                </label>
                {!isHostedActive ? (
                  <p className="settings-muted">Local rules run on-device. No configuration needed.</p>
                ) : (
                  <>
                    <label className="settings-field">
                      <span>{sessionKeyLabel}</span>
                      <div className="settings-key-row">
                        <input
                          type={keyVisible ? 'text' : 'password'}
                          autoComplete="new-password"
                          value={sessionKey}
                          onChange={(event) => onSessionKeyChange(activeProviderId, event.target.value)}
                          placeholder="Paste your API key"
                        />
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => setKeyVisible(!keyVisible)}
                          aria-label={keyVisible ? 'Hide key' : 'Show key'}
                        >
                          {keyVisible ? 'Hide' : 'Show'}
                        </button>
                      </div>
                    </label>
                    <p className="settings-muted">Key stays in memory for this session only. Clears on reload.</p>

                    {activeProviderDef.editableBaseUrl ? (
                      <label className="settings-field">
                        <span>Base URL (optional)</span>
                        <input
                          type="url"
                          value={activeBaseUrlOverride ?? ''}
                          onChange={(event) => updateHostedBaseUrl(event.target.value)}
                          placeholder={activeProviderDef.endpoint?.defaultBaseUrl ?? ''}
                          autoComplete="off"
                        />
                      </label>
                    ) : null}

                    <div className="settings-test-area">
                      <button
                        type="button"
                        className="btn btn-secondary"
                        disabled={!sessionKey.trim() || isTesting}
                        onClick={handleTestConnection}
                      >
                        {isTesting ? 'Testing\u2026' : 'Test connection'}
                      </button>
                      {connectionResult ? (
                        <span className={`settings-test-badge ${connectionResult.ok ? 'ok' : 'err'}`}>
                          {connectionResult.ok ? `\u2713 Connected to ${activeProviderDef.label}` : `\u2717 ${connectionResult.message}`}
                        </span>
                      ) : null}
                      {modelsLoading ? <span className="settings-muted" style={{ marginLeft: 8 }}>Loading models\u2026</span> : null}
                    </div>

                    <label className="settings-field">
                      <span>Model</span>
                      <select
                        value={activeModelId}
                        onChange={(event) => { if (isGenericHostedActive) updateHostedModel(event.target.value) }}
                        disabled={modelsLoading}
                      >
                        {modelOptions.map((model) => (
                          <option key={model.id} value={model.id}>{model.label}</option>
                        ))}
                      </select>
                    </label>
                    {showCuratedFallbackHint ? (
                      <p className="settings-muted">Live model listing unavailable. Showing curated models.</p>
                    ) : null}

                    <label className="settings-check">
                      <input type="checkbox" checked={consentAccepted} onChange={(event) => updateHostedConsent(event.target.checked)} />
                      <span>{consentHelp}</span>
                    </label>
                  </>
                )}
                <p className="settings-muted">{isOllamaActive ? 'Selecting a provider enables it for AI features. Consent + preview acceptance required before sending data.' : 'Selecting a provider enables it for AI features. Consent + preview acceptance required before sending data.'}</p>
              </section>

              <CreditsUsagePanel
                supabaseEnv={supabaseEnv}
                authStatus={authStatus}
                connectionTestCost={preview.estimatedCreditCost}
              />

              <section className="settings-panel settings-panel--wide" aria-labelledby="preview-settings-title">
                <h4 id="preview-settings-title">Request preview</h4>
                <p className="settings-muted">Before using AI features, review what would be sent. API keys are never persisted or included in previews. Estimated cost: {preview.estimatedCreditCost} credits.</p>
                <pre className="request-preview">{JSON.stringify(preview, null, 2)}</pre>
                <div className="settings-actions">
                  <button type="button" className={`btn ${acceptedPreviewHash === preview.payloadHash ? 'btn-secondary' : 'btn-primary'}`} onClick={() => {
                    onAcceptPreview(preview.payloadHash)
                    const nextGate = canRunHostedAI({ settings: aiSettings, sessionApiKey: sessionKey, acceptedPreviewHash: preview.payloadHash, preview })
                    setStatusMessage(nextGate.ok ? 'Preview accepted. You can now use AI features with this provider.' : ('reason' in nextGate ? nextGate.reason : ''))
                  }}>
                    {acceptedPreviewHash === preview.payloadHash ? '\u2713 Preview accepted' : 'Accept preview'}
                  </button>
                </div>
                {statusToShow ? <p className="settings-status">{statusToShow}</p> : null}
                {settingsSavedAt ? <p className="settings-muted">Saved {new Date(settingsSavedAt).toLocaleTimeString()}</p> : null}
              </section>
            </div>
          )}

          {settingsTab === 'data' && (
            <div className="settings-grid">
              <section className="settings-panel" aria-labelledby="workspace-settings-title">
                <h4 id="workspace-settings-title">Workspace</h4>
                <p className="settings-muted">{isHosted ? 'Personal workspaces keep your content separate. Teams are reserved for the hosted product.' : 'Personal is private by default. Teams are disabled in local builds and reserved for the future hosted product.'}</p>
                <div className="segmented-control segmented-control--wide" role="group" aria-label="Workspace mode">
                  <button type="button" className={workspaceMode === 'personal' ? 'active' : ''} onClick={() => onWorkspaceModeChange('personal')}>Personal</button>
                  <button type="button" disabled title={workspaceModes['team-preview'].description}>Team</button>
                </div>
                <div className="settings-row"><span>Active workspace</span><strong>{activeWorkspace.name}</strong></div>
                {!isHosted ? (
                  <div className="settings-row"><span>Workspace ID</span><strong>{activeWorkspace.id}</strong></div>
                ) : null}
                <p className="settings-muted">{activeWorkspace.description}</p>
              </section>

              <section className="settings-panel" aria-labelledby="factory-reset-title">
                <h4 id="factory-reset-title">Factory reset</h4>
                <p className="settings-muted">This permanently deletes all ideas, projects, tasks, and notes in the current workspace. Cannot be undone.</p>
                <div className="settings-actions">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={async () => {
                      if (!confirm('Factory reset? This will permanently delete ALL ideas, projects, tasks, and notes. This cannot be undone. Continue?')) return
                      await onClearData()
                      setClearDataMessage('Factory reset complete.')
                    }}
                  >Factory reset</button>
                </div>
                {clearDataMessage ? <p className="settings-status">{clearDataMessage}</p> : null}
              </section>
            </div>
          )}

          {settingsTab === 'billing' && isHosted && (
            <div className="settings-grid">
              <BillingSettingsPanel activeWorkspace={activeWorkspace} authStatus={authStatus} workspaceBootstrap={workspaceBootstrap} />
            </div>
          )}

          {settingsTab === 'advanced' && !isHosted && (
            <div className="settings-grid">
              <AuditLogPanel
                activeWorkspace={activeWorkspace}
                supabaseEnv={supabaseEnv}
                authStatus={authStatus}
              />
              <TeamSettingsPanel
                activeWorkspace={activeWorkspace}
                supabaseEnv={supabaseEnv}
                authStatus={authStatus}
                teamFeaturesEnabled={ENABLE_TEAM_WORKSPACES}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function AuditLogPanel({ activeWorkspace, supabaseEnv, authStatus }: {
  activeWorkspace: ActiveWorkspace
  supabaseEnv: ResolvedSupabaseEnv
  authStatus: AuthStatus
}) {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [error, setError] = useState('')
  const canLoad = supabaseEnv.configured && authStatus.mode === 'signed-in' && activeWorkspace.type === 'team'

  useEffect(() => {
    if (!canLoad) return
    let active = true
    void (async () => {
      const result = await listAuditLog(activeWorkspace.id, 20)
      if (!active) return
      if (result.ok) setEntries(result.data)
      else setError(result.error)
    })()
    return () => { active = false }
  }, [canLoad, activeWorkspace.id])

  return (
    <section className="settings-panel" aria-labelledby="audit-settings-title">
      <h4 id="audit-settings-title">Audit log</h4>
      {!supabaseEnv.configured ? (
        <p className="settings-muted">Audit logs are only recorded in cloud mode.</p>
      ) : authStatus.mode !== 'signed-in' ? (
        <p className="settings-muted">Sign in to see workspace audit entries.</p>
      ) : activeWorkspace.type !== 'team' ? (
        <p className="settings-muted">Switch to a team workspace to inspect its audit trail. Personal workspaces don't record audit entries.</p>
      ) : entries.length === 0 ? (
        <p className="settings-muted">No audit entries yet.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {entries.map((entry) => (
            <li key={entry.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12 }}>
              <span>
                <strong>{entry.action}</strong>
                {entry.targetType ? <em style={{ color: 'var(--muted)', marginLeft: 6 }}>{entry.targetType}</em> : null}
              </span>
              <span style={{ color: 'var(--muted)' }}>{new Date(entry.createdAt).toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
      {error ? <p className="settings-status settings-status--error">{error}</p> : null}
    </section>
  )
}

function CreditsUsagePanel({ supabaseEnv, authStatus, connectionTestCost }: {
  supabaseEnv: ResolvedSupabaseEnv
  authStatus: AuthStatus
  connectionTestCost: number
}) {
  const [balance, setBalance] = useState<DailyCreditBalance | null>(null)
  const [events, setEvents] = useState<UsageEvent[]>([])
  const [error, setError] = useState('')
  const canLoad = supabaseEnv.configured && authStatus.mode === 'signed-in'

  useEffect(() => {
    if (!canLoad) return
    let active = true
    void (async () => {
      const [balanceResult, eventsResult] = await Promise.all([getTodayBalance(), listRecentUsage(10)])
      if (!active) return
      if (balanceResult.ok) setBalance(balanceResult.data)
      if (eventsResult.ok) setEvents(eventsResult.data)
      if (!balanceResult.ok || !eventsResult.ok) {
        setError(!balanceResult.ok ? balanceResult.error : (eventsResult.ok ? '' : eventsResult.error))
      }
    })()
    return () => { active = false }
  }, [canLoad])

  return (
    <section className="settings-panel" aria-labelledby="credits-settings-title">
      <h4 id="credits-settings-title">Credits and usage</h4>
      <p className="settings-muted">Daily free credits reset at UTC midnight. BYOK usage is free and doesn't count against your daily limit.</p>
      <div className="settings-row"><span>Free daily credits</span><strong>{DAILY_FREE_AI_CREDITS}</strong></div>
      <div className="settings-row"><span>Connection test cost</span><strong>{connectionTestCost} credits</strong></div>
      {canLoad && balance ? (
        <>
          <div className="settings-row"><span>Used today</span><strong>{balance.used} / {balance.granted}</strong></div>
          <div className="settings-row"><span>Remaining</span><strong>{balance.remaining}</strong></div>
        </>
      ) : (
        <p className="settings-muted">Sign in to view your daily balance and recent AI usage.</p>
      )}
      {canLoad && events.length > 0 ? (
        <div className="settings-row settings-row--stack">
          <span>Recent AI activity</span>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {events.map((event) => (
              <li key={event.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12 }}>
                <span>
                  <strong>{event.actionType}</strong>
                  <em style={{ color: 'var(--muted)', marginLeft: 6 }}>
                    {event.providerId} · {event.modelId}
                  </em>
                </span>
                <span style={{ color: 'var(--muted)' }}>
                  {event.usedByok ? 'BYOK' : `-${event.creditsCharged}`}
                  {event.status !== 'ok' ? ` · ${event.status}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {error ? <p className="settings-status settings-status--error">{error}</p> : null}
    </section>
  )
}

function BillingSettingsPanel({ activeWorkspace, authStatus, workspaceBootstrap }: { activeWorkspace: ActiveWorkspace; authStatus: AuthStatus; workspaceBootstrap: PersonalWorkspaceBootstrapStatus }) {
  const billingEnv = useMemo(() => getBillingEnv(), [])
  const workspaceId = workspaceBootstrap.mode === 'ready' && workspaceBootstrap.workspaceId ? workspaceBootstrap.workspaceId : activeWorkspace.id
  const { status, error, loading } = useSubscriptionStatus(workspaceId, authStatus)
  const [pricingOpen, setPricingOpen] = useState(false)
  const [busyPlanId, setBusyPlanId] = useState<string | null>(null)
  const [actionError, setActionError] = useState('')
  const canUseBilling = billingEnv.configured && authStatus.mode === 'signed-in'
  const isServiceDown = !loading && (error || status.status === 'unavailable')

  async function startCheckout(planId: string) {
    setBusyPlanId(planId)
    setActionError('')
    const result = await createCheckoutSession(workspaceId, planId)
    setBusyPlanId(null)
    if (result.ok) {
      window.location.assign(result.data.url)
      return
    }
    setActionError(result.error)
  }

  async function openPortal() {
    setActionError('')
    const result = await createBillingPortalSession(workspaceId)
    if (result.ok) {
      window.location.assign(result.data.url)
      return
    }
    setActionError(result.error)
  }

  return (
    <section className="settings-panel" aria-labelledby="billing-settings-title">
      <h4 id="billing-settings-title">Hosted billing</h4>
      {!billingEnv.configured ? (
        <p className="settings-muted">Billing wrapper not configured. The MIT app stays fully usable without Stripe. Add VITE_BILLING_URL in a private hosted deployment to enable plans.</p>
      ) : authStatus.mode !== 'signed-in' ? (
        <p className="settings-muted">Sign in to check hosted plan status.</p>
      ) : (
        <>
          {isServiceDown ? (
            <div className="settings-panel" style={{ marginBottom: 0 }}>
              <p className="settings-muted">Billing service is temporarily unavailable. Retry after a moment.</p>
            </div>
          ) : (
            <>
              <p className="settings-muted">Your subscription covers all workspaces in your account.</p>
              <div className="settings-row"><span>Current plan</span><strong>{loading ? 'Checking…' : status.planName}</strong></div>
              <div className="settings-row"><span>Status</span><strong>{loading ? '…' : status.status}</strong></div>
              {status.periodEnd ? <div className="settings-row"><span>Period ends</span><strong>{new Date(status.periodEnd).toLocaleDateString()}</strong></div> : null}
              {status.plans.length > 0 ? (
                <div style={{ marginTop: 12 }}>
                  <span style={{ fontWeight: 600, fontSize: '0.85em', color: 'var(--muted)' }}>Available features by plan</span>
                  {status.plans.map((plan) => {
                    const isCurrent = plan.id === status.planId
                    return (
                      <div key={plan.id} style={{ marginTop: 8, opacity: isCurrent ? 1 : 0.5 }}>
                        <span style={{ fontWeight: 600 }}>{plan.name}{isCurrent ? <span style={{ marginLeft: 6, color: 'var(--accent)', fontSize: '0.85em' }}>· Current</span> : null}</span>
                        <ul className="settings-list" style={{ marginTop: 4 }}>
                          {plan.features.map((feature) => <li key={feature}>{feature}</li>)}
                        </ul>
                      </div>
                    )
                  })}
                </div>
              ) : null}
              <div className="settings-actions">
                <button type="button" className="btn btn-primary" disabled={!canUseBilling} onClick={() => setPricingOpen(true)}>Upgrade</button>
                <button type="button" className="btn btn-secondary" disabled={!canUseBilling} onClick={() => void openPortal()}>Manage billing</button>
              </div>
            </>
          )}
        </>
      )}
      {!isServiceDown && (error || actionError) ? <p className="settings-status settings-status--error">{error || actionError}</p> : null}
      {pricingOpen ? (
        <PricingModal
          plans={status.plans}
          currentPlanId={status.planId}
          busyPlanId={busyPlanId}
          error={actionError}
          onClose={() => setPricingOpen(false)}
          onSelectPlan={startCheckout}
        />
      ) : null}
    </section>
  )
}

function TeamSettingsPanel({ activeWorkspace, supabaseEnv, authStatus, teamFeaturesEnabled }: {
  activeWorkspace: ActiveWorkspace
  supabaseEnv: ResolvedSupabaseEnv
  authStatus: AuthStatus
  teamFeaturesEnabled: boolean
}) {
  const [members, setMembers] = useState<WorkspaceMember[]>([])
  const [invites, setInvites] = useState<WorkspaceInvite[]>([])
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<InviteRole>('member')
  const [status, setStatus] = useState('')
  const [statusTone, setStatusTone] = useState<'info' | 'success' | 'error'>('info')
  const [isBusy, setIsBusy] = useState(false)

  const canLoad = teamFeaturesEnabled && supabaseEnv.configured && authStatus.mode === 'signed-in' && activeWorkspace.type === 'team'

  useEffect(() => {
    if (!canLoad) return
    let active = true
    void (async () => {
      const [memberResult, inviteResult] = await Promise.all([
        listWorkspaceMembers(activeWorkspace.id),
        listWorkspaceInvites(activeWorkspace.id),
      ])
      if (!active) return
      if (memberResult.ok) setMembers(memberResult.data)
      if (inviteResult.ok) setInvites(inviteResult.data)
      if (!memberResult.ok || !inviteResult.ok) {
        setStatusTone('error')
        setStatus(!memberResult.ok ? memberResult.error : (inviteResult.ok ? '' : inviteResult.error))
      }
    })()
    return () => { active = false }
  }, [canLoad, activeWorkspace.id])

  async function handleInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canLoad || isBusy) return
    const trimmed = inviteEmail.trim()
    if (!trimmed) return
    setIsBusy(true)
    const result = await inviteWorkspaceMember(activeWorkspace.id, trimmed, inviteRole)
    setIsBusy(false)
    if (result.ok) {
      setStatusTone('success')
      setStatus(`Invite sent to ${trimmed}. Share link token: ${result.data.token.slice(0, 6)}…`)
      setInviteEmail('')
      const refreshed = await listWorkspaceInvites(activeWorkspace.id)
      if (refreshed.ok) setInvites(refreshed.data)
    } else {
      setStatusTone('error')
      setStatus(result.error)
    }
  }

  async function handleRevoke(inviteId: string) {
    setIsBusy(true)
    const result = await revokeWorkspaceInvite(inviteId)
    setIsBusy(false)
    if (result.ok) {
      setInvites((current) => current.map((item) => (item.id === inviteId ? { ...item, status: 'revoked' } : item)))
    } else {
      setStatusTone('error')
      setStatus(result.error)
    }
  }

  async function handleRemove(userId: string) {
    setIsBusy(true)
    const result = await removeWorkspaceMember(activeWorkspace.id, userId)
    setIsBusy(false)
    if (result.ok) {
      setMembers((current) => current.map((member) => (member.userId === userId ? { ...member, status: 'removed' } : member)))
    } else {
      setStatusTone('error')
      setStatus(result.error)
    }
  }

  return (
    <section className="settings-panel" aria-labelledby="team-settings-title">
      <h4 id="team-settings-title">Team settings</h4>
      {!teamFeaturesEnabled ? (
        <p className="settings-muted">Teams are disabled in the local app. They will belong to the future hosted OpenNapse plan, where shared workspaces, invites, billing, and RLS-backed sync can be managed safely.</p>
      ) : !supabaseEnv.configured ? (
        <p className="settings-muted">Team features require the hosted Supabase path. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, then sign in.</p>
      ) : authStatus.mode !== 'signed-in' ? (
        <p className="settings-muted">Sign in to manage team workspaces.</p>
      ) : activeWorkspace.type !== 'team' ? (
        <p className="settings-muted">Active workspace is personal. Create a team workspace from the toolbar selector to invite members.</p>
      ) : (
        <>
          <div className="settings-row"><span>Active team</span><strong>{activeWorkspace.name}</strong></div>
          <form className="settings-field" onSubmit={handleInvite}>
            <span>Invite a member</span>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input
                type="email"
                autoComplete="email"
                placeholder="teammate@example.com"
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
                disabled={isBusy}
                style={{ flex: '1 1 220px', minWidth: 180 }}
              />
              <select value={inviteRole} onChange={(event) => setInviteRole(event.target.value as InviteRole)} disabled={isBusy}>
                <option value="member">Member</option>
                <option value="admin">Admin</option>
                <option value="viewer">Viewer</option>
              </select>
              <button type="submit" className="btn btn-primary" disabled={isBusy || inviteEmail.trim().length === 0}>Send invite</button>
            </div>
          </form>
          <div className="settings-row settings-row--stack">
            <span>Pending invites</span>
            {invites.length === 0 ? <small style={{ color: 'var(--muted)' }}>No invites yet.</small> : (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {invites.map((invite) => (
                  <li key={invite.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 13 }}>
                    <span>{invite.email} · <em style={{ color: 'var(--muted)' }}>{invite.role} · {invite.status}</em></span>
                    {invite.status === 'pending' ? (
                      <button type="button" className="btn btn-ghost btn-compact" onClick={() => void handleRevoke(invite.id)} disabled={isBusy}>Revoke</button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="settings-row settings-row--stack">
            <span>Members</span>
            {members.length === 0 ? <small style={{ color: 'var(--muted)' }}>No members loaded yet.</small> : (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {members.map((member) => (
                  <li key={member.userId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 13 }}>
                    <span>{member.email ?? member.userId.slice(0, 8)} · <em style={{ color: 'var(--muted)' }}>{member.role} · {member.status}</em></span>
                    {member.status === 'active' && member.role !== 'owner' ? (
                      <button type="button" className="btn btn-ghost btn-compact" onClick={() => void handleRemove(member.userId)} disabled={isBusy}>Remove</button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
          {status ? <p className={`settings-status settings-status--${statusTone}`}>{status}</p> : null}
        </>
      )}
    </section>
  )
}

function CreateWorkspaceModal({ allowTeamWorkspaces, onCreate, onClose }: {
  allowTeamWorkspaces: boolean
  onCreate: (name: string, type: 'personal' | 'team') => Promise<void>
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [type, setType] = useState<'personal' | 'team'>('personal')
  const [isBusy, setIsBusy] = useState(false)
  const [error, setError] = useState('')
  const trimmed = name.trim()

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!trimmed || isBusy) return
    setIsBusy(true)
    try {
      await onCreate(trimmed, allowTeamWorkspaces ? type : 'personal')
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setIsBusy(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="settings-modal sign-in-modal" role="dialog" aria-modal="true" aria-labelledby="create-workspace-title" onClick={(event) => event.stopPropagation()}>
        <div className="brain-dump-header">
          <div>
            <p className="eyebrow">Workspace</p>
            <h3 id="create-workspace-title">Create a new workspace</h3>
          </div>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>
        <form className="settings-panel" onSubmit={handleSubmit}>
          <p className="settings-muted">
            Each workspace is its own container for ideas, projects, tasks, and notes. Personal workspaces are private by default. Team workspaces are reserved for the hosted product.
          </p>
          <label className="settings-field">
            <span>Name</span>
            <input
              type="text"
              autoFocus
              maxLength={80}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Side projects"
              disabled={isBusy}
            />
          </label>
          <div className="settings-row">
            <span>Type</span>
            <div className="segmented-control" role="group" aria-label="Workspace type">
              <button type="button" className={type === 'personal' ? 'active' : ''} onClick={() => setType('personal')} disabled={isBusy}>Personal</button>
              <button type="button" className={type === 'team' ? 'active' : ''} onClick={() => setType('team')} disabled={isBusy || !allowTeamWorkspaces} title={allowTeamWorkspaces ? 'Create a shared workspace' : 'Teams are reserved for the hosted OpenNapse plan.'}>Team</button>
            </div>
          </div>
          {!allowTeamWorkspaces ? <p className="settings-muted">Team workspaces require the hosted OpenNapse plan. Sign in with Supabase configured to unlock them.</p> : null}
          <div className="settings-actions">
            <button type="submit" className="btn btn-primary" disabled={isBusy || trimmed.length === 0}>
              {isBusy ? 'Creating…' : 'Create workspace'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={isBusy}>Cancel</button>
          </div>
          {error ? <p className="settings-status settings-status--error">{error}</p> : null}
        </form>
      </div>
    </div>
  )
}

const TUTORIAL_DISMISSED_KEY = 'OpenNapse:v0:tutorial-dismissed'

function TutorialOverlay({ hasContent }: { hasContent: boolean }) {
  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true
    try {
      return localStorage.getItem(TUTORIAL_DISMISSED_KEY) === 'true'
    } catch {
      return false
    }
  })
  const [step, setStep] = useState(0)

  // Only show the tutorial for genuinely fresh workspaces.
  if (dismissed || hasContent) return null

  const steps: Array<{ title: string; body: string }> = [
    {
      title: 'Welcome to OpenNapse',
      body: 'Capture ideas fast, promote the ones that matter into projects, and keep everything organized in one place.',
    },
    {
      title: 'Capture quickly',
      body: 'Press Space or tap Dump idea to open the brain dump modal. Ideas start as "raw" and you can bury stale ones later.',
    },
    {
      title: 'Workspaces and teams',
      body: 'Use the workspace dropdown in the toolbar to switch between containers. You can organize ideas, projects, and notes across different workspaces.',
    },
    {
      title: 'Everything else',
      body: 'Cmd/Ctrl + K opens the command palette. Settings holds AI providers, credits, and privacy controls. Click the sync pill to sign in and connect your account. Ready when you are.',
    },
  ]

  function finish() {
    try { localStorage.setItem(TUTORIAL_DISMISSED_KEY, 'true') } catch { /* ignore */ }
    setDismissed(true)
  }

  const current = steps[step]
  const isLast = step === steps.length - 1

  return (
    <div className="tutorial-overlay" role="dialog" aria-modal="true" aria-labelledby="tutorial-title">
      <div className="tutorial-card">
        <div className="tutorial-progress" aria-hidden="true">
          {steps.map((_, index) => (
            <span key={index} className={index === step ? 'active' : index < step ? 'done' : ''} />
          ))}
        </div>
        <h3 id="tutorial-title">{current.title}</h3>
        <p>{current.body}</p>
        <div className="tutorial-actions">
          <button type="button" className="btn btn-ghost btn-compact" onClick={finish}>Skip tour</button>
          {step > 0 ? (
            <button type="button" className="btn btn-ghost btn-compact" onClick={() => setStep((s) => s - 1)}>Back</button>
          ) : null}
          {isLast ? (
            <button type="button" className="btn btn-primary btn-compact" onClick={finish}>Done</button>
          ) : (
            <button type="button" className="btn btn-primary btn-compact" onClick={() => setStep((s) => s + 1)}>Next</button>
          )}
        </div>
      </div>
    </div>
  )
}

function SignInModal({ supabaseEnv, authStatus, workspaceBootstrap, onClose }: {
  supabaseEnv: ResolvedSupabaseEnv
  authStatus: AuthStatus
  workspaceBootstrap: PersonalWorkspaceBootstrapStatus
  onClose: () => void
}) {
  const [email, setEmail] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [statusMessage, setStatusMessage] = useState('')
  const [statusTone, setStatusTone] = useState<'info' | 'success' | 'error'>('info')
  const trimmedEmail = email.trim()
  const disabled = !supabaseEnv.configured || isSending || trimmedEmail.length === 0

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (disabled) return
    setIsSending(true)
    setStatusTone('info')
    setStatusMessage('Sending magic link…')
    const result = await requestMagicLink(trimmedEmail)
    setIsSending(false)
    setStatusTone(result.ok ? 'success' : 'error')
    setStatusMessage(result.message)
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="settings-modal sign-in-modal" role="dialog" aria-modal="true" aria-labelledby="sign-in-title" onClick={(event) => event.stopPropagation()}>
        <div className="brain-dump-header">
          <div>
            <p className="eyebrow">Sign in</p>
            <h3 id="sign-in-title">Welcome back</h3>
          </div>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>

        {!supabaseEnv.configured ? (
          <div className="settings-panel">
            <p className="settings-muted">{supabaseEnv.message}</p>
          </div>
        ) : authStatus.mode === 'signed-in' ? (
          <div className="settings-panel">
            <p className="settings-status">Signed in as {authStatus.email ?? 'a Supabase user'}.</p>
            <p className="settings-muted">{workspaceBootstrap.description}</p>
          </div>
        ) : (
          <form className="settings-panel" onSubmit={handleSubmit}>
            <p className="settings-muted">
              Enter your email and we'll send you a magic link. No password required. Your personal workspace is created the first time you sign in.
            </p>
            <label className="settings-field">
              <span>Email</span>
              <input
                type="email"
                autoComplete="email"
                autoFocus
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                disabled={isSending}
              />
            </label>
            <div className="settings-actions">
              <button type="submit" className="btn btn-primary" disabled={disabled}>
                {isSending ? 'Sending…' : 'Send magic link'}
              </button>
              <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            </div>
            {statusMessage ? (
              <p className={`settings-status settings-status--${statusTone}`} role="status" aria-live="polite">{statusMessage}</p>
            ) : null}
            <p className="settings-muted">Connected to {supabaseEnv.projectHost ?? 'Supabase'}. Magic links expire after a short window.</p>
          </form>
        )}
      </div>
    </div>
  )
}

export default App
