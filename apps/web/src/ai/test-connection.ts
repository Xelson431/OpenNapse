import type { AIProviderId } from './provider'
import { AI_PROVIDERS, resolveEndpoint } from './provider'

export interface ListedModel {
  id: string
  label: string
}

function authHeaders(apiKey: string, providerId: AIProviderId): Record<string, string> {
  const def = AI_PROVIDERS[providerId]
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (def.endpoint?.auth === 'x-api-key') {
    headers['x-api-key'] = apiKey
    if (providerId === 'anthropic') {
      headers['anthropic-version'] = '2023-06-01'
      headers['anthropic-dangerous-direct-browser-access'] = 'true'
    }
  } else {
    headers['Authorization'] = `Bearer ${apiKey}`
  }
  return headers
}

async function fetchWithTimeout(input: RequestInfo, init: RequestInit, timeout = 10000): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    const res = await fetch(input, { ...init, signal: controller.signal })
    return res
  } finally {
    clearTimeout(timer)
  }
}

export async function testProviderConnection(
  apiKey: string,
  providerId: AIProviderId,
  baseUrl?: string,
): Promise<{ ok: true; provider: string } | { ok: false; error: string }> {
  const def = AI_PROVIDERS[providerId]
  if (!def.hosted || !def.endpoint) {
    return { ok: false, error: `${def.label} does not support connection testing.` }
  }

  const url = resolveEndpoint(providerId, baseUrl)
  const headers = authHeaders(apiKey, providerId)

  let body: unknown
  if (providerId === 'anthropic') {
    body = {
      model: def.models[0]!.id,
      max_tokens: 1,
      messages: [{ role: 'user', content: 'ok' }],
    }
  } else if (providerId === 'ollama-cloud') {
    body = {
      model: 'nemotron-3-super',
      messages: [{ role: 'user', content: 'ok' }],
      stream: false,
    }
  } else {
    body = {
      model: def.models[0]!.id,
      messages: [{ role: 'user', content: 'ok' }],
      max_tokens: 1,
      stream: false,
    }
  }

  try {
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      const detail = text ? `: ${text.slice(0, 200)}` : ''
      return { ok: false, error: `${res.status} ${res.statusText}${detail}` }
    }
    return { ok: true, provider: def.label }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('Load failed') || msg.includes('aborted')) {
      return {
        ok: false,
        error: `${def.label} blocked the browser request (CORS).`,
      }
    }
    return { ok: false, error: msg }
  }
}

function modelsListUrl(providerId: AIProviderId, baseUrl?: string): string {
  const def = AI_PROVIDERS[providerId]
  if (!def.endpoint) return ''

  const base = (def.editableBaseUrl && baseUrl && baseUrl.trim())
    ? baseUrl.trim().replace(/\/+$/, '')
    : def.endpoint.defaultBaseUrl

  if (providerId === 'ollama-cloud') {
    return `${base}/api/tags`
  }

  const path = def.endpoint.chatPath
    .replace('/chat/completions', '/models')
    .replace('/messages', '/models')
  return `${base}${path}`
}

export async function listProviderModels(
  apiKey: string,
  providerId: AIProviderId,
  baseUrl?: string,
): Promise<{ ok: true; models: ListedModel[] } | { ok: false; error: string }> {
  const def = AI_PROVIDERS[providerId]
  if (!def.hosted || !def.endpoint) {
    return { ok: false, error: `${def.label} does not support model listing.` }
  }

  const url = modelsListUrl(providerId, baseUrl)
  const headers = authHeaders(apiKey, providerId)

  try {
    const res = await fetchWithTimeout(url, { method: 'GET', headers })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      const detail = text ? `: ${text.slice(0, 200)}` : ''
      return { ok: false, error: `${res.status} ${res.statusText}${detail}` }
    }

    const json = await res.json() as Record<string, unknown>
    let raw: unknown[] = []

    if (providerId === 'ollama-cloud') {
      const models = (json as { models?: unknown[] }).models
      raw = models ?? []
    } else {
      const data = (json as { data?: unknown[] }).data
      raw = data ?? []
    }

    const models: ListedModel[] = raw.map((m: unknown) => {
      const entry = m as { id?: string; name?: string; display_name?: string; label?: string }
      return {
        id: entry.id ?? entry.name ?? '',
        label: entry.display_name ?? entry.name ?? entry.label ?? entry.id ?? 'Unknown',
      }
    }).filter((m) => m.id)

    if (models.length === 0) {
      return { ok: false, error: 'No models returned by provider.' }
    }

    return { ok: true, models }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('Load failed') || msg.includes('aborted')) {
      return { ok: false, error: `CORS blocked model listing for ${def.label}.` }
    }
    return { ok: false, error: msg }
  }
}
