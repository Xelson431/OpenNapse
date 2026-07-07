import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

const now = '2026-05-09T00:00:00.000Z'
const alphaProjectId = '11111111-1111-4111-8111-111111111111'
const betaProjectId = '22222222-2222-4222-8222-222222222222'

function projectRecord(id: string, title: string, updatedAt = now) {
  return { id, workspaceId: 'local-personal-workspace', createdBy: 'test-user', title, description: '', sourceIdeaId: null, whyNow: 'Test why now', firstStep: 'Test first step', doneLooksLike: 'Test done', status: 'planning', color: '#78716C', createdAt: now, updatedAt, version: 1, clientId: 'test-client', deviceId: 'test-device', isDeleted: false }
}

function ideaRecord(id: string, title: string, projectId: string | null = null) {
  return { id, workspaceId: 'local-personal-workspace', createdBy: 'test-user', title, body: '', status: 'raw', projectId, tags: [], color: '#78716C', energyLevel: null, mood: null, createdAt: now, updatedAt: now, lastTouchedAt: now, buriedAt: null, version: 1, clientId: 'test-client', deviceId: 'test-device', isDeleted: false }
}

function ideaDataTransfer() {
  const data = new Map<string, string>()
  const types: string[] = []
  return {
    effectAllowed: 'uninitialized',
    dropEffect: 'none',
    types,
    setData(type: string, value: string) {
      data.set(type, value)
      if (!types.includes(type)) types.push(type)
    },
    getData(type: string) {
      return data.get(type) ?? ''
    },
    clearData(type?: string) {
      if (type) {
        data.delete(type)
        const index = types.indexOf(type)
        if (index >= 0) types.splice(index, 1)
        return
      }
      data.clear()
      types.splice(0, types.length)
    },
  } as unknown as DataTransfer
}

describe('App shell', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('hides internal roadmap content from the product UI', () => {
    render(<App />)

    expect(screen.queryByText('Implementation map')).not.toBeInTheDocument()
    expect(screen.queryByText('Infrastructure readiness')).not.toBeInTheDocument()
    expect(screen.queryByText('Local assistant')).not.toBeInTheDocument()
  })

  it('captures a local idea through the modal', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /dump idea/i }))
    await user.type(screen.getByLabelText(/what should not be lost/i), 'Build secure local-first sync')
    await user.click(screen.getByRole('button', { name: /save locally/i }))

    expect(await screen.findByText('Build secure local-first sync')).toBeInTheDocument()
    expect(localStorage.getItem('OpenNapse:v0:ideas')).toContain('Build secure local-first sync')
  })

  it('saves dumped ideas to the selected project or General Knowledge', async () => {
    const user = userEvent.setup()
    localStorage.setItem('OpenNapse:v0:projects', JSON.stringify([
      projectRecord(alphaProjectId, 'Alpha Project'),
    ]))
    render(<App />)

    expect(screen.queryByRole('button', { name: /quick capture/i })).not.toBeInTheDocument()
    await user.click(await screen.findByRole('treeitem', { name: /alpha project/i }))
    await user.click(screen.getByRole('button', { name: /dump idea/i }))
    expect(screen.getByText(/saving to alpha project/i)).toBeInTheDocument()
    await user.type(screen.getByLabelText(/what should not be lost/i), 'Project scoped idea')
    await user.click(screen.getByRole('button', { name: /save locally/i }))

    await user.click(screen.getByRole('treeitem', { name: /alpha project/i }))
    await user.click(screen.getByRole('button', { name: /dump idea/i }))
    expect(screen.getByText(/saving to general knowledge/i)).toBeInTheDocument()
    await user.type(screen.getByLabelText(/what should not be lost/i), 'General idea')
    await user.click(screen.getByRole('button', { name: /save locally/i }))

    const stored = JSON.parse(localStorage.getItem('OpenNapse:v0:ideas') ?? '[]') as Array<{ title: string; projectId: string | null }>
    expect(stored.find((idea) => idea.title === 'Project scoped idea')).toMatchObject({ projectId: alphaProjectId })
    expect(stored.find((idea) => idea.title === 'General idea')).toMatchObject({ projectId: null })
  })

  it('enhances a short idea title when Enhance with AI is checked', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /dump idea/i }))
    const enhanceCheckbox = screen.getByRole('checkbox', { name: /enhance with ai/i })
    expect(enhanceCheckbox).toBeInTheDocument()
    await user.click(enhanceCheckbox)

    await user.type(screen.getByLabelText(/what should not be lost/i), 'build a todo app')
    await user.click(screen.getByRole('button', { name: /save locally/i }))

    expect(await screen.findByText(/build a todo app\. consider breaking this down into concrete next steps\./i)).toBeInTheDocument()
  })

  it('appends speech transcript to the capture input when mic is used', async () => {
    const user = userEvent.setup()

    interface MockResultEvent {
      resultIndex: number
      results: Array<Array<{ transcript: string }>>
    }

    let mockResultHandler: ((event: MockResultEvent) => void) | null = null
    let mockEndHandler: (() => void) | null = null

    class MockSpeechRecognition {
      continuous = false
      interimResults = false
      lang = 'en-US'
      onresult: ((event: MockResultEvent) => void) | null = null
      onerror: (() => void) | null = null
      onend: (() => void) | null = null
      start() {
        mockResultHandler = this.onresult
        mockEndHandler = this.onend
      }
      stop() {
        mockEndHandler?.()
      }
    }

    Object.assign(window, { SpeechRecognition: MockSpeechRecognition })

    render(<App />)
    await user.click(screen.getByRole('button', { name: /dump idea/i }))

    const micButton = screen.getByRole('button', { name: /start voice input/i })
    expect(micButton).toBeInTheDocument()

    await user.click(micButton)
    expect(screen.getByText('Listening…')).toBeInTheDocument()

    act(() => {
      mockResultHandler?.({
        resultIndex: 0,
        results: [[{ transcript: 'Voice captured idea' }]],
      })
    })

    expect(screen.getByLabelText(/what should not be lost/i)).toHaveValue('Voice captured idea')

    await user.click(screen.getByRole('button', { name: /stop listening/i }))
    expect(screen.queryByText('Listening…')).not.toBeInTheDocument()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).SpeechRecognition
  })

  it('promotes an idea into a project and first task', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /dump idea/i }))
    await user.type(screen.getByLabelText(/what should not be lost/i), 'Design a premium focus mode')
    await user.click(screen.getByRole('button', { name: /save locally/i }))

    await user.click(await screen.findByRole('button', { name: /promote/i }))
    await user.type(screen.getByPlaceholderText(/why now/i), 'The base app shell is ready')
    await user.type(screen.getByLabelText(/first concrete step/i), 'Sketch the collapsed sidebar state')
    await user.type(screen.getByLabelText(/done looks like/i), 'A calm focused single-item view')
    await user.click(screen.getByRole('button', { name: /create project/i }))

    expect(await screen.findByText('Commitment records')).toBeInTheDocument()
    expect(screen.getAllByText('Design a premium focus mode').length).toBeGreaterThanOrEqual(1)
    expect(localStorage.getItem('OpenNapse:v0:projects')).toContain('Design a premium focus mode')
    expect(localStorage.getItem('OpenNapse:v0:tasks')).toContain('Sketch the collapsed sidebar state')
  })

  it('shows operational notes, graph, focus, and stats views', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getAllByRole('button', { name: /^notes$/i })[0])
    expect(screen.getByLabelText('Local document')).toBeInTheDocument()

    await user.click(screen.getAllByRole('button', { name: /^graph$/i })[0])
    expect(screen.getByText('Entity map')).toBeInTheDocument()

    await user.click(screen.getAllByRole('button', { name: /^focus$/i })[0])
    expect(screen.getByText('Slot 1')).toBeInTheDocument()

    await user.click(screen.getAllByRole('button', { name: /^stats$/i })[0])
    expect(screen.getByText('Export / import JSON')).toBeInTheDocument()
  })

  it('records and saves a voice memo attached to a note', async () => {
    const user = userEvent.setup()

    class MockMediaRecorder {
      state = 'inactive'
      ondataavailable: ((event: { data: Blob }) => void) | null = null
      onstop: (() => void) | null = null
      start() { this.state = 'recording' }
      stop() {
        this.state = 'inactive'
        this.ondataavailable?.({ data: new Blob(['test-audio'], { type: 'audio/webm' }) })
        this.onstop?.()
      }
    }

    class MockFileReader {
      result: string | ArrayBuffer | null = null
      onloadend: (() => void) | null = null
      readAsDataURL() {
        this.result = 'data:audio/webm;base64,dGVzdC1hdWRpbw=='
        this.onloadend?.()
      }
    }

    Object.assign(window, { MediaRecorder: MockMediaRecorder, FileReader: MockFileReader })
    Object.assign(navigator, { mediaDevices: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }) } })

    render(<App />)
    await user.click(screen.getAllByRole('button', { name: /^notes$/i })[0])

    await user.click(screen.getByRole('button', { name: /record voice memo/i }))
    expect(screen.getByText('Recording…')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /stop recording/i }))
    await waitFor(() => expect(screen.queryByText('Recording…')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: /delete recording/i })).toBeInTheDocument()

    await user.clear(screen.getByLabelText(/note title/i))
    await user.type(screen.getByLabelText(/note title/i), 'Voice note')
    await user.click(screen.getByRole('button', { name: /save note/i }))

    await waitFor(() => {
      const storedNotes = JSON.parse(localStorage.getItem('OpenNapse:v0:notes') ?? '[]') as Array<{ title: string; voiceRecordings: Array<{ dataUrl: string }> }>
      const note = storedNotes.find((n) => n.title === 'Voice note')
      expect(note).toBeTruthy()
      expect(note?.voiceRecordings.length).toBe(1)
      expect(note?.voiceRecordings[0].dataUrl).toBe('data:audio/webm;base64,dGVzdC1hdWRpbw==')
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).MediaRecorder
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).FileReader
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (navigator as any).mediaDevices
  })

  it('lets the graph select a node for details', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /dump idea/i }))
    await user.type(screen.getByLabelText(/what should not be lost/i), 'Graph selection idea')
    await user.click(screen.getByRole('button', { name: /save locally/i }))

    await user.click(screen.getAllByRole('button', { name: /^graph$/i })[0])
    expect(screen.getByRole('button', { name: /auto-organize/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /zoom in/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /focus map/i })).toBeInTheDocument()
    const [node, listItem] = await screen.findAllByRole('button', { name: /graph selection idea/i })
    await user.click(listItem)

    expect(node).toHaveAttribute('aria-pressed', 'true')
    expect(listItem).toHaveAttribute('aria-current', 'true')

    await user.click(listItem)

    expect(node).toHaveAttribute('aria-pressed', 'false')
    expect(listItem).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('heading', { name: /select a node/i })).toBeInTheDocument()
  })

  it('keeps Kanban active when a project folder is selected', async () => {
    const user = userEvent.setup()
    localStorage.setItem('OpenNapse:v0:projects', JSON.stringify([
      projectRecord(alphaProjectId, 'Alpha Project', '2026-05-09T00:00:00.000Z'),
      projectRecord(betaProjectId, 'Beta Project', '2026-05-10T00:00:00.000Z'),
    ]))
    render(<App />)

    await user.click(screen.getAllByRole('button', { name: /^kanban$/i })[0])
    await user.click(await screen.findByRole('treeitem', { name: /alpha project/i }))

    expect(screen.getByLabelText(/new task title/i)).toBeInTheDocument()
    expect(screen.getByText('Alpha Project', { selector: '.kanban-project-name' })).toBeInTheDocument()
  })

  it('hides Suggestions and Mentor surfaces', () => {
    render(<App />)

    expect(screen.queryByRole('heading', { name: /suggestions/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('complementary', { name: /mentor assistant/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /show mentor/i })).not.toBeInTheDocument()
  })

  it('moves linked ideas to another sidebar project by drag and drop', async () => {
    const user = userEvent.setup()
    const ideaId = '33333333-3333-4333-8333-333333333333'
    localStorage.setItem('OpenNapse:v0:projects', JSON.stringify([
      projectRecord(alphaProjectId, 'Alpha Project', '2026-05-09T00:00:00.000Z'),
      projectRecord(betaProjectId, 'Beta Project', '2026-05-10T00:00:00.000Z'),
    ]))
    localStorage.setItem('OpenNapse:v0:ideas', JSON.stringify([
      ideaRecord(ideaId, 'Portable idea', alphaProjectId),
    ]))
    render(<App />)

    await user.click(screen.getAllByRole('button', { name: /^dashboard$/i })[0])
    await user.click(await screen.findByRole('treeitem', { name: /alpha project/i }))
    const record = await screen.findByRole('button', { name: /idea record: portable idea/i })
    const betaProject = screen.getByRole('treeitem', { name: /beta project/i })
    const dataTransfer = ideaDataTransfer()

    fireEvent.dragStart(record, { dataTransfer })
    fireEvent.dragEnter(betaProject, { dataTransfer })
    fireEvent.dragOver(betaProject, { dataTransfer })
    fireEvent.drop(betaProject, { dataTransfer })

    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem('OpenNapse:v0:ideas') ?? '[]') as Array<{ id: string; projectId: string; version: number }>
      expect(stored.find((idea) => idea.id === ideaId)).toMatchObject({ projectId: betaProjectId, version: 2 })
    })
  })

  it('supports local search and manual task creation', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /dump idea/i }))
    await user.type(screen.getByLabelText(/what should not be lost/i), 'Searchable moonshot idea')
    await user.click(screen.getByRole('button', { name: /save locally/i }))
    await user.type(screen.getByPlaceholderText(/search ideas/i), 'moonshot')
    expect(await screen.findByText('Searchable moonshot idea')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /promote/i }))
    await user.type(screen.getByPlaceholderText(/why now/i), 'It is searchable')
    await user.type(screen.getByLabelText(/first concrete step/i), 'Create task seed')
    await user.type(screen.getByLabelText(/done looks like/i), 'Search and task creation work')
    await user.click(screen.getByRole('button', { name: /create project/i }))
    await user.click(screen.getAllByRole('button', { name: /^kanban$/i })[0])
    await user.type(screen.getByLabelText(/new task title/i), 'Manual follow-up task')
    await user.click(screen.getByRole('button', { name: /add task/i }))

    expect(await screen.findByText('Manual follow-up task')).toBeInTheDocument()
  })

  it('persists dark mode from the nav toggle', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /toggle theme/i }))

    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(localStorage.getItem('OpenNapse:v0:theme')).toBe('dark')
  })

  it('filters ideas from sidebar tags', async () => {
    localStorage.clear()
    const now = new Date().toISOString()
    localStorage.setItem('OpenNapse:v0:ideas', JSON.stringify([
      { id: crypto.randomUUID(), workspaceId: 'local-personal-workspace', createdBy: 'test-user', title: 'AI workflow idea', body: '', status: 'raw', tags: ['ai'], color: '#78716C', energyLevel: null, mood: null, createdAt: now, updatedAt: now, lastTouchedAt: now, buriedAt: null, version: 1, clientId: 'test-client', deviceId: 'test-device', isDeleted: false },
      { id: crypto.randomUUID(), workspaceId: 'local-personal-workspace', createdBy: 'test-user', title: 'Design polish idea', body: '', status: 'raw', tags: ['design'], color: '#78716C', energyLevel: null, mood: null, createdAt: now, updatedAt: now, lastTouchedAt: now, buriedAt: null, version: 1, clientId: 'test-client', deviceId: 'test-device', isDeleted: false },
    ]))
    const user = userEvent.setup()
    render(<App />)

    expect(await screen.findByText('AI workflow idea')).toBeInTheDocument()
    expect(screen.getByText('Design polish idea')).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: /tags/i }))
    await user.click(screen.getByRole('treeitem', { name: /ai/i }))

    expect(screen.getByText('AI workflow idea')).toBeInTheDocument()
    expect(screen.queryByText('Design polish idea')).not.toBeInTheDocument()
  })

  it('runs command palette actions from the keyboard', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.keyboard('{Control>}k{/Control}')
    await user.type(screen.getByPlaceholderText(/search commands/i), 'kanban')
    await user.keyboard('{Enter}')

    expect(screen.getByText(/Promote an idea to create a board/i)).toBeInTheDocument()
  })

  it('tests provider connection without persisting the session key', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /settings/i }))
    await user.click(screen.getByRole('button', { name: /^ai$/i }))
    await user.selectOptions(screen.getByRole('combobox', { name: /^provider$/i }), 'ollama-cloud')
    await user.type(screen.getByLabelText(/ollama cloud api key/i), 'session-only-test-key')
    await user.click(screen.getByRole('button', { name: /test connection/i }))
    await waitFor(() => {
      expect(document.querySelector('.settings-test-badge.err')).toBeInTheDocument()
    })
    expect(localStorage.getItem('OpenNapse:v0:ai-settings')).not.toContain('session-only-test-key')
    expect(JSON.stringify({ ...localStorage })).not.toContain('session-only-test-key')
    expect(JSON.stringify({ ...sessionStorage })).not.toContain('session-only-test-key')
  })

  it('renders the privacy-first workspace and rich settings surfaces', async () => {
    const user = userEvent.setup()
    render(<App />)

    expect(screen.getByRole('combobox', { name: /select workspace/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /settings/i }))

    expect(screen.getByRole('dialog', { name: /settings/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /^Profile$/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Privacy and security/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/email for magic link/i)).toBeDisabled()
    expect(screen.getByLabelText(/email for magic link/i)).toHaveValue('')
    expect(screen.getByRole('button', { name: /send magic link/i })).toBeDisabled()
    expect(screen.queryByRole('button', { name: /sign out/i })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^data$/i }))
    expect(screen.getByRole('heading', { name: /Workspace/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^ai$/i }))
    expect(screen.getByRole('heading', { name: /Credits and usage/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^advanced$/i }))
    expect(screen.getByRole('heading', { name: /Team settings/i })).toBeInTheDocument()
  })

  it('moves Kanban cards with keyboard controls', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /dump idea/i }))
    await user.type(screen.getByLabelText(/what should not be lost/i), 'Keyboard accessible Kanban')
    await user.click(screen.getByRole('button', { name: /save locally/i }))
    await user.click(await screen.findByRole('button', { name: /promote/i }))
    await user.type(screen.getByPlaceholderText(/why now/i), 'Keyboard task movement matters')
    await user.type(screen.getByLabelText(/first concrete step/i), 'Move me with keyboard')
    await user.type(screen.getByLabelText(/done looks like/i), 'Kanban cards move without dragging')
    await user.click(screen.getByRole('button', { name: /create project/i }))
    await user.click(screen.getAllByRole('button', { name: /^kanban$/i })[0])

    const card = await screen.findByRole('button', { name: /Task: Move me with keyboard/i })
    fireEvent.keyDown(card, { key: 'ArrowRight', altKey: true })

    await waitFor(() => {
      expect(localStorage.getItem('OpenNapse:v0:tasks')).toContain('"columnId":"todo"')
    })
  })

  it('saves a new note via the dirty-state save button for guest users', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getAllByRole('button', { name: /^notes$/i })[0])

    await user.clear(screen.getByLabelText(/note title/i))
    await user.type(screen.getByLabelText(/note title/i), 'Dirty-state test note')

    const saveBtn = screen.getByRole('button', { name: /save note/i })
    expect(saveBtn).not.toBeDisabled()

    await user.click(saveBtn)

    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem('OpenNapse:v0:notes') ?? '[]') as Array<{ title: string }>
      expect(stored.some((n) => n.title === 'Dirty-state test note')).toBe(true)
    })
  })

  it('saves an existing note after changing title', async () => {
    const user = userEvent.setup()
    const noteId = crypto.randomUUID()
    const now = new Date().toISOString()
    localStorage.setItem('OpenNapse:v0:notes', JSON.stringify([
      { id: noteId, workspaceId: 'local-personal-workspace', createdBy: 'test-user', title: 'Original title', content: 'Hello', linkedProjectId: null, tags: [], color: '#78716C', voiceRecordings: [], createdAt: now, updatedAt: now, version: 1, clientId: 'test', deviceId: 'test', isDeleted: false },
    ]))
    render(<App />)

    await user.click(screen.getAllByRole('button', { name: /^notes$/i })[0])
    await screen.findByText('Original title')

    await user.clear(screen.getByLabelText(/note title/i))
    await user.type(screen.getByLabelText(/note title/i), 'Updated title')

    const saveBtn = screen.getByRole('button', { name: 'Save' })
    expect(saveBtn).not.toBeDisabled()
    await user.click(saveBtn)

    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem('OpenNapse:v0:notes') ?? '[]') as Array<{ id: string; title: string }>
      const note = stored.find((n) => n.id === noteId)
      expect(note?.title).toBe('Updated title')
    })
  })

  it('renders WYSIWYG toolbar with formatting buttons', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getAllByRole('button', { name: /^notes$/i })[0])

    expect(screen.getByTitle('Bold')).toBeInTheDocument()
    expect(screen.getByTitle('Italic')).toBeInTheDocument()
    expect(screen.getByTitle('Underline')).toBeInTheDocument()
    expect(screen.getByTitle('Code')).toBeInTheDocument()
    expect(screen.getByTitle('Link')).toBeInTheDocument()
    expect(screen.getByTitle('Bullet list')).toBeInTheDocument()
    expect(screen.getByTitle('Numbered list')).toBeInTheDocument()
  })

  it('renders contenteditable editor for rich text input', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getAllByRole('button', { name: /^notes$/i })[0])

    const editor = document.querySelector('[contenteditable="true"]')
    expect(editor).toBeInTheDocument()
    expect(editor).toHaveClass('note-editor-rich')
  })

  it('handles rapid save clicks without double-saving', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getAllByRole('button', { name: /^notes$/i })[0])
    await user.clear(screen.getByLabelText(/note title/i))
    await user.type(screen.getByLabelText(/note title/i), 'Rapid save note')

    const saveBtn = screen.getByRole('button', { name: /save note/i })
    for (let i = 0; i < 5; i++) {
      await user.click(saveBtn)
    }

    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem('OpenNapse:v0:notes') ?? '[]') as Array<{ title: string; version: number }>
      const note = stored.find((n) => n.title === 'Rapid save note')
      expect(note).toBeTruthy()
      expect(note!.version).toBeLessThanOrEqual(2)
    })
  })

  it('survives empty title save without error', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getAllByRole('button', { name: /^notes$/i })[0])

    await user.clear(screen.getByLabelText(/note title/i))
    await user.click(screen.getByRole('button', { name: /save note/i }))

    // Should not crash — note should exist with empty title or be handled gracefully
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem('OpenNapse:v0:notes') ?? '[]') as Array<{ title: string }>
      // The app may save with empty title or silently ignore — either is fine as long as no crash
      expect(Array.isArray(stored)).toBe(true)
    })
  })

  it('rapidly clears and retypes note title without data loss', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getAllByRole('button', { name: /^notes$/i })[0])

    // Cycle: type → clear → type → clear → type
    const titleInput = screen.getByLabelText(/note title/i)
    await user.clear(titleInput)
    await user.type(titleInput, 'First draft')
    await user.clear(titleInput)
    await user.type(titleInput, 'Second attempt')
    await user.clear(titleInput)
    await user.type(titleInput, 'Final version')

    await user.click(screen.getByRole('button', { name: /save note/i }))

    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem('OpenNapse:v0:notes') ?? '[]') as Array<{ title: string }>
      expect(stored.some((n) => n.title === 'Final version')).toBe(true)
      expect(stored.every((n) => n.title !== 'First draft')).toBe(true)
      expect(stored.every((n) => n.title !== 'Second attempt')).toBe(true)
    })
  })

  it('preserves content with special characters and HTML-like text', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getAllByRole('button', { name: /^notes$/i })[0])

    await user.clear(screen.getByLabelText(/note title/i))
    await user.type(screen.getByLabelText(/note title/i), '<script>alert("xss")</script> & "quotes"')

    await user.click(screen.getByRole('button', { name: /save note/i }))

    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem('OpenNapse:v0:notes') ?? '[]') as Array<{ title: string }>
      const note = stored.find((n) => n.title?.includes('<script>'))
      expect(note).toBeTruthy()
    })
  })

  it('handles long note titles', async () => {
    const user = userEvent.setup()
    render(<App />)

    const longTitle = 'A'.repeat(100)

    await user.click(screen.getAllByRole('button', { name: /^notes$/i })[0])
    await user.clear(screen.getByLabelText(/note title/i))
    await user.type(screen.getByLabelText(/note title/i), longTitle)
    await user.click(screen.getByRole('button', { name: /save note/i }))

    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem('OpenNapse:v0:notes') ?? '[]') as Array<{ title: string }>
      const note = stored.find((n) => n.title === longTitle)
      expect(note).toBeTruthy()
    })
  })

  it('creates a note, saves, edits again, saves again (consecutive dirty cycles)', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getAllByRole('button', { name: /^notes$/i })[0])

    // First save
    await user.clear(screen.getByLabelText(/note title/i))
    await user.type(screen.getByLabelText(/note title/i), 'Draft v1')
    await user.click(screen.getByRole('button', { name: /save note/i }))

    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem('OpenNapse:v0:notes') ?? '[]') as Array<{ title: string }>
      expect(stored.some((n) => n.title === 'Draft v1')).toBe(true)
    })

    // Second save — after first save, button becomes "Save" not "Save note"
    await user.clear(screen.getByLabelText(/note title/i))
    await user.type(screen.getByLabelText(/note title/i), 'Draft v2')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem('OpenNapse:v0:notes') ?? '[]') as Array<{ title: string }>
      expect(stored.some((n) => n.title === 'Draft v2')).toBe(true)
      expect(stored.every((n) => n.title !== 'Draft v1')).toBe(true)
    })

    // Third save cycle
    await user.clear(screen.getByLabelText(/note title/i))
    await user.type(screen.getByLabelText(/note title/i), 'Draft v3')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem('OpenNapse:v0:notes') ?? '[]') as Array<{ title: string }>
      expect(stored.some((n) => n.title === 'Draft v3')).toBe(true)
    })
  })
})
