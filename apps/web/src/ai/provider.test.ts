import { describe, expect, it } from 'vitest'
import { AI_ACTION_COSTS, DAILY_FREE_AI_CREDITS } from './action-costs'
import {
  AI_PROVIDERS,
  buildOllamaCloudPreview,
  canRunHostedAI,
  defaultAISettings,
  loadAISettings,
  serializeAISettings,
  type AISettings,
} from './provider'

function memoryStorage(value: string | null) {
  return {
    getItem: () => value,
  }
}

describe('AI provider security scaffold', () => {
  it('defaults to local rules and keeps Ollama Cloud explicit', () => {
    expect(defaultAISettings.activeProviderId).toBe('local-rules')
    expect(AI_PROVIDERS['ollama-cloud'].endpoint?.url).toBe('https://ollama.com/api/chat')
    expect(AI_PROVIDERS['ollama-cloud'].models[0]?.id).toBe('nemotron-3-super')
    expect(AI_PROVIDERS['ollama-cloud'].endpoint?.streamDefault).toBe(false)
  })

  it('does not include secrets in provider definitions', () => {
    const registry = JSON.stringify(AI_PROVIDERS)
    expect(registry).not.toMatch(/apiKey|secret|Authorization|Bearer [A-Za-z0-9._-]+/i)
  })

  it('rejects invalid or secret-shaped persisted settings', () => {
    expect(loadAISettings(memoryStorage('not-json'))).toEqual(defaultAISettings)
    expect(loadAISettings(memoryStorage(JSON.stringify({ ...defaultAISettings, apiKey: 'do-not-return' })))).toEqual(defaultAISettings)
  })

  it('serializes only non-secret settings', () => {
    const settings: AISettings = {
      ...defaultAISettings,
      activeProviderId: 'ollama-cloud',
      ollamaCloud: {
        ...defaultAISettings.ollamaCloud,
        hostedConsentAccepted: true,
        hostedConsentAcceptedAt: '2026-01-01T00:00:00.000Z',
      },
    }

    const serialized = serializeAISettings(settings)
    expect(serialized).toContain('ollama-cloud')
    expect(serialized).not.toMatch(/apiKey|token|secret|Authorization|Bearer [A-Za-z0-9._-]+/i)
  })

  it('builds redacted request previews and gates hosted calls', () => {
    const preview = buildOllamaCloudPreview('connection-test')
    expect(preview.url).toBe('https://ollama.com/api/chat')
    expect(preview.model).toBe('nemotron-3-super')
    expect(preview.headersPreview.Authorization).toBe('Bearer ••••')
    expect(preview.includedDataClasses).toEqual([])
    expect(preview.estimatedCreditCost).toBe(AI_ACTION_COSTS['connection-test'])

    expect(canRunHostedAI({ settings: defaultAISettings, sessionApiKey: '', preview })).toEqual({ ok: false, reason: 'Ollama Cloud is not selected.' })

    const cloudSettings: AISettings = { ...defaultAISettings, activeProviderId: 'ollama-cloud' }
    expect(canRunHostedAI({ settings: cloudSettings, sessionApiKey: '', preview })).toEqual({ ok: false, reason: 'Hosted AI consent is required.' })

    const consentSettings: AISettings = {
      ...cloudSettings,
      ollamaCloud: { ...cloudSettings.ollamaCloud, hostedConsentAccepted: true },
    }
    expect(canRunHostedAI({ settings: consentSettings, sessionApiKey: '', preview })).toEqual({ ok: false, reason: 'Add an Ollama Cloud API key for this session.' })
    expect(canRunHostedAI({ settings: consentSettings, sessionApiKey: 'session-only', preview })).toEqual({ ok: false, reason: 'Review and accept the exact request preview first.' })
    expect(canRunHostedAI({ settings: consentSettings, sessionApiKey: 'session-only', acceptedPreviewHash: preview.payloadHash, preview })).toEqual({ ok: true })
  })

  it('keeps AI credit costs centralized', () => {
    expect(DAILY_FREE_AI_CREDITS).toBe(10)
    expect(AI_ACTION_COSTS['promote-idea-suggestions']).toBe(1)
    expect(AI_ACTION_COSTS['weekly-digest']).toBe(2)
    expect(Object.values(AI_ACTION_COSTS).every((cost) => Number.isInteger(cost) && cost >= 0)).toBe(true)
  })
})
