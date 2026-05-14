import { z } from 'zod'
import { getAIActionCost } from './action-costs'

export type AIProviderId =
  | 'local-rules'
  | 'ollama-cloud'
  | 'openai'
  | 'anthropic'
  | 'openrouter'
  | 'mistral'
  | 'deepseek'
  | 'groq'

export type AIProviderCategory =
  | 'local'
  | 'ollama-cloud'
  | 'openai-compatible'
  | 'anthropic-compatible'

export type AIProviderTransport = 'local' | 'hosted-http'
export type AIActionType = 'connection-test' | 'promote-idea-suggestions' | 'weekly-digest'

export interface AIProviderDefinition {
  id: AIProviderId
  label: string
  category: AIProviderCategory
  transport: AIProviderTransport
  hosted: boolean
  consentRequired: boolean
  /** OpenAI-compatible and Anthropic-compatible providers can point at user-supplied endpoints. */
  editableBaseUrl: boolean
  endpoint?: {
    method: 'POST'
    url: string
    defaultBaseUrl: string
    chatPath: string
    auth: 'bearer' | 'x-api-key'
    streamDefault: false
  }
  models: readonly {
    id: string
    label: string
    default?: boolean
  }[]
}

export const AI_PROVIDERS: Record<AIProviderId, AIProviderDefinition> = {
  'local-rules': {
    id: 'local-rules',
    label: 'Local rules',
    category: 'local',
    transport: 'local',
    hosted: false,
    consentRequired: false,
    editableBaseUrl: false,
    models: [{ id: 'rules-v1', label: 'Rules v1', default: true }],
  },
  'ollama-cloud': {
    id: 'ollama-cloud',
    label: 'Ollama Cloud',
    category: 'ollama-cloud',
    transport: 'hosted-http',
    hosted: true,
    consentRequired: true,
    editableBaseUrl: false,
    endpoint: {
      method: 'POST',
      url: 'https://ollama.com/api/chat',
      defaultBaseUrl: 'https://ollama.com',
      chatPath: '/api/chat',
      auth: 'bearer',
      streamDefault: false,
    },
    models: [{ id: 'nemotron-3-super', label: 'Nemotron 3 Super', default: true }],
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    category: 'openai-compatible',
    transport: 'hosted-http',
    hosted: true,
    consentRequired: true,
    editableBaseUrl: true,
    endpoint: {
      method: 'POST',
      url: 'https://api.openai.com/v1/chat/completions',
      defaultBaseUrl: 'https://api.openai.com',
      chatPath: '/v1/chat/completions',
      auth: 'bearer',
      streamDefault: false,
    },
    models: [
      { id: 'gpt-4o-mini', label: 'GPT-4o mini', default: true },
      { id: 'gpt-4o', label: 'GPT-4o' },
      { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini' },
      { id: 'gpt-4.1', label: 'GPT-4.1' },
    ],
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic',
    category: 'anthropic-compatible',
    transport: 'hosted-http',
    hosted: true,
    consentRequired: true,
    editableBaseUrl: true,
    endpoint: {
      method: 'POST',
      url: 'https://api.anthropic.com/v1/messages',
      defaultBaseUrl: 'https://api.anthropic.com',
      chatPath: '/v1/messages',
      auth: 'x-api-key',
      streamDefault: false,
    },
    models: [
      { id: 'claude-3-5-haiku-latest', label: 'Claude 3.5 Haiku', default: true },
      { id: 'claude-3-5-sonnet-latest', label: 'Claude 3.5 Sonnet' },
      { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
    ],
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    category: 'openai-compatible',
    transport: 'hosted-http',
    hosted: true,
    consentRequired: true,
    editableBaseUrl: false,
    endpoint: {
      method: 'POST',
      url: 'https://openrouter.ai/api/v1/chat/completions',
      defaultBaseUrl: 'https://openrouter.ai/api',
      chatPath: '/v1/chat/completions',
      auth: 'bearer',
      streamDefault: false,
    },
    models: [
      { id: 'openai/gpt-4o-mini', label: 'GPT-4o mini (via OpenRouter)', default: true },
      { id: 'anthropic/claude-3.5-haiku', label: 'Claude 3.5 Haiku (via OpenRouter)' },
      { id: 'meta-llama/llama-3.1-70b-instruct', label: 'Llama 3.1 70B Instruct' },
      { id: 'qwen/qwen-2.5-72b-instruct', label: 'Qwen 2.5 72B Instruct' },
    ],
  },
  mistral: {
    id: 'mistral',
    label: 'Mistral',
    category: 'openai-compatible',
    transport: 'hosted-http',
    hosted: true,
    consentRequired: true,
    editableBaseUrl: false,
    endpoint: {
      method: 'POST',
      url: 'https://api.mistral.ai/v1/chat/completions',
      defaultBaseUrl: 'https://api.mistral.ai',
      chatPath: '/v1/chat/completions',
      auth: 'bearer',
      streamDefault: false,
    },
    models: [
      { id: 'mistral-small-latest', label: 'Mistral Small', default: true },
      { id: 'mistral-medium-latest', label: 'Mistral Medium' },
      { id: 'mistral-large-latest', label: 'Mistral Large' },
    ],
  },
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek',
    category: 'openai-compatible',
    transport: 'hosted-http',
    hosted: true,
    consentRequired: true,
    editableBaseUrl: false,
    endpoint: {
      method: 'POST',
      url: 'https://api.deepseek.com/v1/chat/completions',
      defaultBaseUrl: 'https://api.deepseek.com',
      chatPath: '/v1/chat/completions',
      auth: 'bearer',
      streamDefault: false,
    },
    models: [
      { id: 'deepseek-chat', label: 'DeepSeek Chat', default: true },
      { id: 'deepseek-reasoner', label: 'DeepSeek Reasoner' },
    ],
  },
  groq: {
    id: 'groq',
    label: 'Groq',
    category: 'openai-compatible',
    transport: 'hosted-http',
    hosted: true,
    consentRequired: true,
    editableBaseUrl: false,
    endpoint: {
      method: 'POST',
      url: 'https://api.groq.com/openai/v1/chat/completions',
      defaultBaseUrl: 'https://api.groq.com/openai',
      chatPath: '/v1/chat/completions',
      auth: 'bearer',
      streamDefault: false,
    },
    models: [
      { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B Instant', default: true },
      { id: 'llama-3.1-70b-versatile', label: 'Llama 3.1 70B Versatile' },
      { id: 'mixtral-8x7b-32768', label: 'Mixtral 8x7B 32k' },
    ],
  },
} as const

const providerIdSchema = z.enum([
  'local-rules',
  'ollama-cloud',
  'openai',
  'anthropic',
  'openrouter',
  'mistral',
  'deepseek',
  'groq',
])

// Per-provider settings block stored per hosted provider.
const hostedProviderConfigSchema = z.object({
  modelId: z.string().min(1).max(200),
  baseUrl: z.string().url().max(500).optional(),
  hostedConsentAccepted: z.boolean(),
  hostedConsentAcceptedAt: z.string().optional(),
  consentTextVersion: z.string().min(1).max(120),
}).strict()

export type HostedProviderConfig = z.infer<typeof hostedProviderConfigSchema>

export const aiSettingsSchema = z.object({
  schemaVersion: z.literal(1),
  activeProviderId: providerIdSchema,
  ollamaCloud: z.object({
    model: z.literal('nemotron-3-super'),
    hostedConsentAccepted: z.boolean(),
    hostedConsentAcceptedAt: z.string().optional(),
    consentTextVersion: z.literal('ollama-cloud-hosted-ai-v1'),
  }),
  providers: z.object({
    openai: hostedProviderConfigSchema,
    anthropic: hostedProviderConfigSchema,
    openrouter: hostedProviderConfigSchema,
    mistral: hostedProviderConfigSchema,
    deepseek: hostedProviderConfigSchema,
    groq: hostedProviderConfigSchema,
  }),
}).strict()

export type AISettings = z.infer<typeof aiSettingsSchema>

export const AI_SETTINGS_STORAGE_KEY = 'OpenNapse:v0:ai-settings'

type HostedProviderKey = 'openai' | 'anthropic' | 'openrouter' | 'mistral' | 'deepseek' | 'groq'

function defaultHostedConfig(providerId: HostedProviderKey): HostedProviderConfig {
  const def = AI_PROVIDERS[providerId]
  const defaultModel = def.models.find((m) => m.default) ?? def.models[0]
  return {
    modelId: defaultModel?.id ?? '',
    hostedConsentAccepted: false,
    consentTextVersion: `${providerId}-hosted-ai-v1`,
  }
}

export const defaultAISettings: AISettings = {
  schemaVersion: 1,
  activeProviderId: 'local-rules',
  ollamaCloud: {
    model: 'nemotron-3-super',
    hostedConsentAccepted: false,
    consentTextVersion: 'ollama-cloud-hosted-ai-v1',
  },
  providers: {
    openai: defaultHostedConfig('openai'),
    anthropic: defaultHostedConfig('anthropic'),
    openrouter: defaultHostedConfig('openrouter'),
    mistral: defaultHostedConfig('mistral'),
    deepseek: defaultHostedConfig('deepseek'),
    groq: defaultHostedConfig('groq'),
  },
}

const SECRET_FIELD_PATTERN = /api.?key|token|secret|authorization|bearer/i

function hasSecretShapedKey(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (SECRET_FIELD_PATTERN.test(key)) return true
    const nested = (value as Record<string, unknown>)[key]
    if (nested && typeof nested === 'object' && hasSecretShapedKey(nested)) return true
  }
  return false
}

export function loadAISettings(storage: Pick<Storage, 'getItem'> = localStorage): AISettings {
  const raw = storage.getItem(AI_SETTINGS_STORAGE_KEY)
  if (!raw) return defaultAISettings

  try {
    const parsed = JSON.parse(raw) as unknown
    if (hasSecretShapedKey(parsed)) return defaultAISettings
    return aiSettingsSchema.parse(parsed)
  } catch {
    return defaultAISettings
  }
}

export function serializeAISettings(settings: AISettings): string {
  return JSON.stringify(aiSettingsSchema.parse(settings))
}

export function resolveEndpoint(providerId: AIProviderId, override?: string): string {
  const def = AI_PROVIDERS[providerId]
  if (!def.endpoint) return ''
  if (def.editableBaseUrl && override && override.trim()) {
    const normalized = override.trim().replace(/\/+$/, '')
    return `${normalized}${def.endpoint.chatPath}`
  }
  return def.endpoint.url
}

export interface AIRequestPreview {
  providerId: AIProviderId
  actionType: AIActionType
  method: 'POST'
  url: string
  model: string
  headersPreview: Record<string, string>
  bodyPreview: unknown
  includedDataClasses: string[]
  includedRecordIds: string[]
  estimatedCharacterCount: number
  estimatedCreditCost: number
  payloadHash: string
}

function hashPreviewPayload(value: string): string {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(31, hash) + value.charCodeAt(index) | 0
  }
  return Math.abs(hash).toString(16).padStart(8, '0')
}

export function buildOllamaCloudPreview(actionType: AIActionType, userPrompt = 'Reply with OK'): AIRequestPreview {
  const messages = [
    { role: 'system' as const, content: 'You are OpenNapse assistant. Return concise, safe, structured help.' },
    { role: 'user' as const, content: userPrompt },
  ]
  const bodyPreview = { model: 'nemotron-3-super' as const, messages, stream: false as const }
  const serialized = JSON.stringify({ actionType, bodyPreview })

  return {
    providerId: 'ollama-cloud',
    actionType,
    method: 'POST',
    url: 'https://ollama.com/api/chat',
    model: 'nemotron-3-super',
    headersPreview: {
      Authorization: 'Bearer ••••',
      'Content-Type': 'application/json',
    },
    bodyPreview,
    includedDataClasses: actionType === 'connection-test' ? [] : ['selected workspace context'],
    includedRecordIds: [],
    estimatedCharacterCount: serialized.length,
    estimatedCreditCost: getAIActionCost(actionType),
    payloadHash: hashPreviewPayload(serialized),
  }
}

export function buildProviderPreview(input: {
  providerId: AIProviderId
  actionType: AIActionType
  modelId: string
  baseUrl?: string
  userPrompt?: string
}): AIRequestPreview | null {
  const { providerId, actionType, modelId, baseUrl, userPrompt = 'Reply with OK' } = input
  const def = AI_PROVIDERS[providerId]
  if (!def.endpoint) return null
  if (providerId === 'ollama-cloud') return buildOllamaCloudPreview(actionType, userPrompt)

  const url = resolveEndpoint(providerId, baseUrl)
  const systemMessage = 'You are OpenNapse assistant. Return concise, safe, structured help.'
  let bodyPreview: unknown
  let headersPreview: Record<string, string>

  if (def.category === 'anthropic-compatible') {
    bodyPreview = {
      model: modelId,
      max_tokens: 256,
      system: systemMessage,
      messages: [{ role: 'user' as const, content: userPrompt }],
    }
    headersPreview = {
      'x-api-key': '••••',
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    }
  } else {
    // openai-compatible (OpenAI, OpenRouter, Mistral, DeepSeek, Groq)
    bodyPreview = {
      model: modelId,
      messages: [
        { role: 'system' as const, content: systemMessage },
        { role: 'user' as const, content: userPrompt },
      ],
      stream: false,
    }
    headersPreview = {
      Authorization: 'Bearer ••••',
      'Content-Type': 'application/json',
    }
  }

  const serialized = JSON.stringify({ actionType, bodyPreview })

  return {
    providerId,
    actionType,
    method: 'POST',
    url,
    model: modelId,
    headersPreview,
    bodyPreview,
    includedDataClasses: actionType === 'connection-test' ? [] : ['selected workspace context'],
    includedRecordIds: [],
    estimatedCharacterCount: serialized.length,
    estimatedCreditCost: getAIActionCost(actionType),
    payloadHash: hashPreviewPayload(serialized),
  }
}

type HostedProviderKeyType = HostedProviderKey
type HostedGateInput = {
  settings: AISettings
  sessionApiKey: string
  acceptedPreviewHash?: string
  preview: AIRequestPreview
}

export function canRunHostedAI(input: HostedGateInput): { ok: true } | { ok: false; reason: string } {
  const active = input.settings.activeProviderId
  const previewProvider = input.preview.providerId
  const previewLabel = AI_PROVIDERS[previewProvider].label

  // Active provider must match the preview's provider. Mirrors the original
  // "Ollama Cloud is not selected." gate so existing hosted tests remain valid.
  if (active !== previewProvider) {
    return { ok: false, reason: `${previewLabel} is not selected.` }
  }

  if (active === 'local-rules') {
    return { ok: false, reason: 'Local rules do not need a hosted gate.' }
  }

  if (active === 'ollama-cloud') {
    if (!input.settings.ollamaCloud.hostedConsentAccepted) return { ok: false, reason: 'Hosted AI consent is required.' }
    if (!input.sessionApiKey.trim()) return { ok: false, reason: 'Add an Ollama Cloud API key for this session.' }
    if (input.acceptedPreviewHash !== input.preview.payloadHash) return { ok: false, reason: 'Review and accept the exact request preview first.' }
    return { ok: true }
  }

  const providerKey = active as HostedProviderKeyType
  const config = input.settings.providers[providerKey]
  const providerLabel = AI_PROVIDERS[active].label

  if (!config.hostedConsentAccepted) return { ok: false, reason: 'Hosted AI consent is required.' }
  if (!input.sessionApiKey.trim()) return { ok: false, reason: `Add a ${providerLabel} API key for this session.` }
  if (input.acceptedPreviewHash !== input.preview.payloadHash) return { ok: false, reason: 'Review and accept the exact request preview first.' }
  return { ok: true }
}

export function isHostedProvider(providerId: AIProviderId): providerId is Exclude<AIProviderId, 'local-rules'> {
  return AI_PROVIDERS[providerId].hosted
}
