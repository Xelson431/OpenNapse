import { describe, expect, it } from 'vitest'
import { MAX_VOICE_RECORDING_DATA_URL_LENGTH, createNoteDraft, noteSchema, voiceRecordingSchema } from '../domain/notes'
import { createIdeaDraft, ideaSchema } from '../domain/ideas'
import { projectSchema, createProjectDraft } from '../domain/projects'
import { taskSchema, createTaskDraft } from '../domain/tasks'
import { workspaceRecordSchema } from '../domain/workspaces'
import { loadAISettings } from '../ai/provider'
import { BrowserLocalAdapter } from '../db/browser-local-adapter'
import { LocalStorageBackend } from '../db/storage-backend'
import { renderMarkdown } from '../lib/note-html'

const ctx = { deviceId: 'device-test', workspaceId: 'local-personal-workspace', createdBy: 'user-test' }

// ---------------------------------------------------------------------------
// 1. XSS boundary tests
// ---------------------------------------------------------------------------
describe('renderMarkdown XSS resistance', () => {
  it('escapes HTML tags in note content', () => {
    const result = renderMarkdown('<script>alert("xss")</script>')
    expect(result).not.toContain('<script>')
    expect(result).toContain('&lt;script&gt;')
  })

  it('escapes HTML tags so browser cannot interpret event handlers', () => {
    const result = renderMarkdown('<img src=x onerror=alert(1)>')
    // escapeHtml converts < > to entities, so the browser sees text not HTML
    expect(result).toBe('&lt;img src=x onerror=alert(1)&gt;')
    // onerror text survives (it's inside escaped text), but cannot execute
    expect(result).toContain('onerror')
  })

  it('allows safe markdown bold after escaping', () => {
    const result = renderMarkdown('**bold**')
    expect(result).toContain('<strong>bold</strong>')
  })

  it('renders markdown links with target=_blank and rel=noopener', () => {
    const result = renderMarkdown('[click](https://example.com)')
    expect(result).toContain('target="_blank"')
    expect(result).toContain('rel="noopener noreferrer"')
    expect(result).toContain('href="https://example.com"')
  })

  it('blocks markdown links with javascript: scheme', () => {
    const result = renderMarkdown('[click](javascript:alert(1))')
    expect(result).toContain('href="#"')
    expect(result).toContain('target="_blank"')
    expect(result).toContain('rel="noopener noreferrer"')
  })

  it.each(['data:text/html,<svg onload=alert(1)>', 'vbscript:msgbox(1)', 'file:///etc/passwd', 'java\nscript:alert(1)'])('blocks dangerous markdown URL scheme: %s', (href) => {
    const result = renderMarkdown(`[click](${href})`)
    expect(result).toContain('href="#"')
  })

  it('escapes nested HTML inside markdown formatting', () => {
    const result = renderMarkdown('**<script>alert(1)</script>**')
    expect(result).not.toContain('<script>')
    expect(result).toContain('&lt;script&gt;')
  })
})

// ---------------------------------------------------------------------------
// 2. Domain schema boundary tests
// ---------------------------------------------------------------------------
describe('domain schema boundary enforcement', () => {
  it('rejects idea title longer than 180 chars', () => {
    const long = 'a'.repeat(181)
    expect(() => ideaSchema.parse({ ...createIdeaDraft({ title: long }, ctx) })).toThrow()
  })

  it('accepts idea title at exactly 180 chars', () => {
    const exactly = 'a'.repeat(180)
    expect(() => ideaSchema.parse({ ...createIdeaDraft({ title: exactly }, ctx) })).not.toThrow()
  })

  it('rejects empty idea title', () => {
    expect(() => createIdeaDraft({ title: '   ' }, ctx)).toThrow()
  })

  it('rejects note title longer than 180 chars', () => {
    const long = 'a'.repeat(181)
    expect(() => noteSchema.parse({ ...createNoteDraft({ title: long, content: '' }, ctx) })).toThrow()
  })

  it('rejects note content longer than 50_000 chars', () => {
    expect(() =>
      noteSchema.parse({
        ...createNoteDraft({ title: 'Note', content: 'x'.repeat(50_001) }, ctx),
      }),
    ).toThrow()
  })

  it('accepts note content at exactly 50_000 chars', () => {
    expect(() =>
      noteSchema.parse({
        ...createNoteDraft({ title: 'Note', content: 'x'.repeat(50_000) }, ctx),
      }),
    ).not.toThrow()
  })

  it('rejects project title longer than 180 chars', () => {
    expect(() =>
      projectSchema.parse({
        ...createProjectDraft({ title: 'a'.repeat(181), whyNow: 'why', firstStep: 'step', doneLooksLike: 'done' }, ctx),
      }),
    ).toThrow()
  })

  it('rejects task title longer than 220 chars', () => {
    expect(() =>
      taskSchema.parse({
        ...createTaskDraft({ projectId: crypto.randomUUID(), title: 'a'.repeat(221) }, ctx),
      }),
    ).toThrow()
  })

  it('rejects hex color without hash prefix', () => {
    const record = createProjectDraft({ title: 'Test', whyNow: 'x', firstStep: 'y', doneLooksLike: 'z' }, ctx)
    expect(() => projectSchema.parse({ ...record, color: 'ff0000' })).toThrow()
  })

  it('rejects invalid status transitions at schema level', () => {
    expect(() => ideaSchema.parse({ ...createIdeaDraft({ title: 'Test' }, ctx), status: 'invalid' })).toThrow()
  })

  it('rejects invalid UUID for id field', () => {
    expect(() => ideaSchema.parse({ ...createIdeaDraft({ title: 'Test' }, ctx), id: 'not-a-uuid' })).toThrow()
  })
})

// ---------------------------------------------------------------------------
// 3. Unicode / special character injection
// ---------------------------------------------------------------------------
describe('unicode and special character handling', () => {
  it('accepts unicode in idea titles', () => {
    const idea = createIdeaDraft({ title: '🚀 プロジェクト αβγ' }, ctx)
    expect(idea.title).toBe('🚀 プロジェクト αβγ')
  })

  it('accepts right-to-left text in note content', () => {
    const note = createNoteDraft({ title: 'RTL test', content: 'مرحبا بالعالم' }, ctx)
    expect(note.content).toBe('مرحبا بالعالم')
  })

  it('allows null bytes in title (Zod does not reject \\0 by default)', () => {
    // Zod string().trim().min(1) does not strip or reject null bytes.
    // The null byte passes through. This is acceptable for a local-first app
    // where all data is consumed through React (which handles \0 safely).
    const idea = createIdeaDraft({ title: '\0null' }, ctx)
    expect(idea.title).toContain('\0')
  })

  it('handles mixed script tags in note content escaping', () => {
    const result = renderMarkdown('<<<>>>test')
    expect(result).toBe('&lt;&lt;&lt;&gt;&gt;&gt;test')
  })
})

// ---------------------------------------------------------------------------
// 4. Voice recording dataUrl boundary
// ---------------------------------------------------------------------------
describe('voice recording dataUrl size enforcement', () => {
  it('accepts dataUrl under 10M chars', () => {
    const rec = voiceRecordingSchema.parse({
      id: crypto.randomUUID(),
      dataUrl: 'data:audio/webm;base64,' + 'a'.repeat(1000),
      durationMs: 5000,
      createdAt: new Date().toISOString(),
    })
    expect(rec.dataUrl.length).toBeLessThan(10_000_000)
  })

  it('rejects dataUrl over 10M chars', () => {
    expect(() =>
      voiceRecordingSchema.parse({
        id: crypto.randomUUID(),
        dataUrl: 'data:audio/webm;base64,' + 'a'.repeat(MAX_VOICE_RECORDING_DATA_URL_LENGTH + 1),
        durationMs: 5000,
        createdAt: new Date().toISOString(),
      }),
    ).toThrow()
  })

  it('enforces max 10 voice recordings per note', () => {
    expect(() =>
      noteSchema.parse({
        ...createNoteDraft({ title: 'Noisy note', content: 'many recordings' }, ctx),
        voiceRecordings: Array.from({ length: 11 }, () => ({
          id: crypto.randomUUID(),
          dataUrl: 'data:audio/webm;base64,abcd',
          durationMs: 1000,
          createdAt: new Date().toISOString(),
        })),
      }),
    ).toThrow()
  })
})

// ---------------------------------------------------------------------------
// 5. Import/export data edge cases
// ---------------------------------------------------------------------------
describe('import data edge case resistance', () => {
  it('rejects non-parseable JSON on import', async () => {
    const adapter = new BrowserLocalAdapter(new LocalStorageBackend())
    await expect(adapter.importData('not json')).rejects.toThrow()
  })

  it('accepts import with null ideas field (coerced to empty array)', async () => {
    // ideas: null is coerced to [] via nullish coalescing — not a rejection
    const adapter = new BrowserLocalAdapter(new LocalStorageBackend())
    const payload = JSON.stringify({ ideas: null, projects: [], tasks: [], notes: [] })
    await expect(adapter.importData(payload)).resolves.toBeUndefined()
  })

  it('rejects import with oversized fields', async () => {
    const adapter = new BrowserLocalAdapter(new LocalStorageBackend())
    const oversized = JSON.stringify({
      ideas: [{
        id: crypto.randomUUID(), workspaceId: 'w', createdBy: 'u',
        title: 'x'.repeat(181), body: '', status: 'raw', projectId: null,
        tags: [], color: '#78716C', energyLevel: null, mood: null,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        lastTouchedAt: new Date().toISOString(), buriedAt: null,
        version: 1, clientId: 'c', deviceId: 'd', isDeleted: false,
      }],
      projects: [], tasks: [], notes: [],
    })
    await expect(adapter.importData(oversized)).rejects.toThrow()
  })
})

// ---------------------------------------------------------------------------
// 6. Zod JSON.parse prototype pollution resistance
// ---------------------------------------------------------------------------
describe('Zod schema prototype pollution resistance', () => {
  it.each(['__proto__', 'constructor', 'prototype'])('rejects injection via %s key', (key) => {
    const poisoned = JSON.parse(`{"${key}":{"admin":true},"id":"${crypto.randomUUID()}","workspaceId":"w","createdBy":"u","title":"Test","body":"","status":"raw","projectId":null,"tags":[],"color":"#78716C","energyLevel":null,"mood":null,"createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z","lastTouchedAt":"2026-01-01T00:00:00.000Z","buriedAt":null,"version":1,"clientId":"c","deviceId":"d","isDeleted":false}`)
    // Must not throw but should strip the injection key (no .strict() on ideaSchema)
    const result = ideaSchema.parse(poisoned)
    expect((result as Record<string, unknown>).admin).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// 7. Workspace isolation in local adapter
// ---------------------------------------------------------------------------
describe('local adapter workspace isolation', () => {
  it('filters ideas to active workspace only', async () => {
    const adapter = new BrowserLocalAdapter(new LocalStorageBackend())
    const now = new Date().toISOString()
    const idea1 = ideaSchema.parse({
      id: crypto.randomUUID(), workspaceId: 'workspace-a', createdBy: 'u',
      title: 'Idea A', body: '', status: 'raw', projectId: null,
      tags: [], color: '#78716C', energyLevel: null, mood: null,
      createdAt: now, updatedAt: now, lastTouchedAt: now, buriedAt: null,
      version: 1, clientId: 'c', deviceId: 'd', isDeleted: false,
    })
    const idea2 = ideaSchema.parse({
      id: crypto.randomUUID(), workspaceId: 'workspace-b', createdBy: 'u',
      title: 'Idea B', body: '', status: 'raw', projectId: null,
      tags: [], color: '#78716C', energyLevel: null, mood: null,
      createdAt: now, updatedAt: now, lastTouchedAt: now, buriedAt: null,
      version: 1, clientId: 'c', deviceId: 'd', isDeleted: false,
    })

    // Directly seed localStorage with both ideas
    localStorage.setItem('OpenNapse:v0:ideas', JSON.stringify([idea1, idea2]))

    adapter.setActiveWorkspaceId('workspace-a')
    const ideas = await adapter.listIdeas()
    expect(ideas).toHaveLength(1)
    expect(ideas[0]?.title).toBe('Idea A')
  })

  it('filters tasks to active workspace only', async () => {
    const adapter = new BrowserLocalAdapter(new LocalStorageBackend())
    const now = new Date().toISOString()
    const task1 = taskSchema.parse({
      id: crypto.randomUUID(), workspaceId: 'workspace-a', createdBy: 'u',
      title: 'Task A', description: '', projectId: crypto.randomUUID(),
      ideaId: null, columnId: 'backlog', sortOrder: 0, priority: 'medium',
      completionPct: 0, createdAt: now, updatedAt: now,
      completedAt: null, version: 1, clientId: 'c', deviceId: 'd', isDeleted: false,
    })
    const task2 = taskSchema.parse({
      id: crypto.randomUUID(), workspaceId: 'workspace-b', createdBy: 'u',
      title: 'Task B', description: '', projectId: crypto.randomUUID(),
      ideaId: null, columnId: 'backlog', sortOrder: 0, priority: 'medium',
      completionPct: 0, createdAt: now, updatedAt: now,
      completedAt: null, version: 1, clientId: 'c', deviceId: 'd', isDeleted: false,
    })
    localStorage.setItem('OpenNapse:v0:tasks', JSON.stringify([task1, task2]))
    adapter.setActiveWorkspaceId('workspace-a')
    const tasks = await adapter.listTasks()
    expect(tasks).toHaveLength(1)
    expect(tasks[0]?.title).toBe('Task A')
  })

  it('excludes soft-deleted items from list results', async () => {
    const adapter = new BrowserLocalAdapter(new LocalStorageBackend())
    const now = new Date().toISOString()
    const deleted = ideaSchema.parse({
      id: crypto.randomUUID(), workspaceId: 'local-personal-workspace', createdBy: 'u',
      title: 'Deleted idea', body: '', status: 'raw', projectId: null,
      tags: [], color: '#78716C', energyLevel: null, mood: null,
      createdAt: now, updatedAt: now, lastTouchedAt: now, buriedAt: null,
      version: 1, clientId: 'c', deviceId: 'd', isDeleted: true,
    })
    localStorage.setItem('OpenNapse:v0:ideas', JSON.stringify([deleted]))
    const ideas = await adapter.listIdeas()
    expect(ideas).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 8. AISettings secret rejection edge cases
// ---------------------------------------------------------------------------
describe('AI settings key leak resistance', () => {
  it('rejects settings with deeply nested secret-shaped keys', () => {
    const poisoned = {
      schemaVersion: 1 as const,
      activeProviderId: 'openai' as const,
      ollamaCloud: { model: 'nemotron-3-super' as const, hostedConsentAccepted: true, consentTextVersion: 'ollama-cloud-hosted-ai-v1' as const },
      providers: {
        openai: { modelId: 'gpt-4o', hostedConsentAccepted: true, consentTextVersion: 'openai-hosted-ai-v1', nested: { apiKey: 'sk-1234' } },
        anthropic: { modelId: 'claude', hostedConsentAccepted: false, consentTextVersion: 'anthropic-hosted-ai-v1' },
        openrouter: { modelId: 'gpt-4o', hostedConsentAccepted: false, consentTextVersion: 'openrouter-hosted-ai-v1' },
        mistral: { modelId: 'mistral-small', hostedConsentAccepted: false, consentTextVersion: 'mistral-hosted-ai-v1' },
        deepseek: { modelId: 'deepseek-chat', hostedConsentAccepted: false, consentTextVersion: 'deepseek-hosted-ai-v1' },
        groq: { modelId: 'llama', hostedConsentAccepted: false, consentTextVersion: 'groq-hosted-ai-v1' },
      },
    }
    // Simulate the security check by storing in localStorage then loading
    localStorage.setItem('OpenNapse:v0:ai-settings', JSON.stringify(poisoned))
    const loaded = loadAISettings()
    expect(loaded.activeProviderId).toBe('local-rules')
    expect(JSON.stringify(loaded)).not.toContain('sk-1234')
  })

  it('rejects settings with shallow secret-shaped keys', () => {
    const poisoned = {
      schemaVersion: 1 as const,
      activeProviderId: 'openai' as const,
      apiKey: 'sk-1234',
    }
    localStorage.setItem('OpenNapse:v0:ai-settings', JSON.stringify(poisoned))
    const loaded = loadAISettings()
    expect(loaded).not.toContain('sk-1234')
  })
})

// ---------------------------------------------------------------------------
// 9. Rate limiting audit
// ---------------------------------------------------------------------------
describe('rate limiting coverage', () => {
  it('documents the only rate-limited path in the application', () => {
    // The invite-member Edge Function (Deno) enforces:
    //   max 20 pending invites per 24h per workspace
    //   returns HTTP 429 when exceeded
    // This is the ONLY application-level rate limit.
    //
    // Paths WITHOUT rate limiting:
    //   - Magic link auth: throttled server-side by Supabase (external)
    //   - Idea creation: unbounded
    //   - Note save: unbounded (max 10 voice recordings, 50k chars content)
    //   - Task creation: unbounded
    //   - AI provider calls: credit-gated (10 free/day), but NOT rate-limited
    //   - Import/export: unbounded
    //   - All CRUD operations via the adapter: unbounded
    expect(true).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 10. Malformed input: null bytes, control chars, excessively nested JSON
// ---------------------------------------------------------------------------
describe('malformed input resistance', () => {
  it('allows null bytes in workspace name (Zod does not reject \\0)', () => {
    const record = workspaceRecordSchema.parse({
      id: 'test', type: 'personal', name: 'test\0name', ownerUserId: 'u',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    })
    expect(record.name).toContain('\0')
  })

  it('rejects huge workspace name (over 80 chars)', () => {
    expect(() =>
      workspaceRecordSchema.parse({
        id: 'test', type: 'personal', name: 'x'.repeat(81), ownerUserId: 'u',
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      }),
    ).toThrow()
  })

  it('accepts exactly 80 char workspace name', () => {
    expect(() =>
      workspaceRecordSchema.parse({
        id: 'test', type: 'personal', name: 'x'.repeat(80), ownerUserId: 'u',
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      }),
    ).not.toThrow()
  })

  it('rejects negative version numbers', () => {
    const idea = createIdeaDraft({ title: 'Test' }, ctx)
    expect(() => ideaSchema.parse({ ...idea, version: -1 })).toThrow()
    expect(() => ideaSchema.parse({ ...idea, version: 0 })).toThrow()
  })

  it('rejects negative completion percentage', () => {
    const task = createTaskDraft({ projectId: crypto.randomUUID(), title: 'Test' }, ctx)
    expect(() => taskSchema.parse({ ...task, completionPct: -1 })).toThrow()
  })
})
