import crypto from 'node:crypto'
import { getProvider, providerBaseUrl } from '../config/providers.js'

const REQUEST_TIMEOUT_MS = 120000
const LIST_TIMEOUT_MS = 20000
const MISSING_TOOL_RESULT = '[no result recorded]'
const CONTINUE_NUDGE = 'Continue.'

export function parseRetryAfterMs(response, detail) {
  const unitsToMs = { ms: 1, s: 1000, m: 60000, h: 3600000 }
  const fromText = (text) => {
    const match = /try again in\s*([\d.]+)\s*(ms|s|m|h)?/i.exec(String(text ?? ''))
    if (!match) return null
    const value = Number(match[1])
    if (!Number.isFinite(value)) return null
    return Math.round(value * (unitsToMs[(match[2] ?? 's').toLowerCase()] ?? 1000))
  }

  try {
    const header = response?.headers?.get?.('retry-after')
    if (header) {
      const seconds = Number(header)
      if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds * 1000))
      const date = Date.parse(header)
      if (!Number.isNaN(date)) return Math.max(0, date - Date.now())
    }
  } catch {}

  return fromText(detail)
}

export function isToolCallParseError(error) {
  if (!error) return false
  const text = `${error.message ?? ''} ${error.detail ?? ''} ${error.code ?? ''}`.toLowerCase()
  const mentionsParsing =
    text.includes('tool_use_failed') ||
    text.includes('failed_generation') ||
    text.includes('failed to parse tool call') ||
    text.includes('parse tool call arguments') ||
    text.includes('failed to parse function') ||
    (text.includes('tool') && text.includes('json'))
  return error.status === 400 && mentionsParsing
}

export class ProviderError extends Error {
  constructor(message, { status = 0, code = null, detail = '', retryAfterMs = null } = {}) {
    super(message)
    this.name = 'ProviderError'
    this.status = status
    this.code = code
    this.detail = detail
    this.retryAfterMs = retryAfterMs
  }
}

function statusCode(status) {
  if (status === 401 || status === 403) return 'INVALID_KEY'
  if (status === 413) return 'TOO_LARGE'
  if (status === 422) return 'INVALID_REQUEST'
  if (status === 429) return 'RATE_LIMIT'
  if (status >= 500) return 'SERVER_ERROR'
  return 'PROVIDER_ERROR'
}

function buildErrorMessage(providerId, status, detail) {
  const provider = getProvider(providerId)
  const label = provider?.label ?? providerId
  if (status === 401 || status === 403) {
    return `${label} rejected the saved API key. Update it in Settings → AI.`
  }
  if (status === 413) {
    return `${label} rejected the request because it was too large (413).`
  }
  if (status === 422) {
    return `${label} rejected the request as invalid (422)${detail ? `: ${detail}` : '.'}`
  }
  if (status === 429) {
    return `${label} rate limit reached (429)${detail ? `: ${detail}` : '.'}`
  }
  if (status >= 500) return `${label} is unavailable right now (server error).`
  return `${label} API error (${status})${detail ? `: ${detail}` : ''}`
}

async function readErrorDetail(response) {
  try {
    const body = await response.json()
    return {
      detail: body?.error?.message ?? body?.message ?? '',
      code: body?.error?.code ?? body?.code ?? null,
      failedGeneration: body?.error?.failed_generation ?? null,
    }
  } catch {
    return { detail: '', code: null, failedGeneration: null }
  }
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } catch (error) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') {
      throw new ProviderError(
        `The provider did not answer within ${Math.round(timeoutMs / 1000)} seconds.`,
        { code: 'TIMEOUT' },
      )
    }
    throw new ProviderError(`Could not reach the provider: ${error.message}`, {
      code: 'NETWORK',
    })
  } finally {
    clearTimeout(timer)
  }
}

function randomCallId() {
  return `call_${crypto.randomBytes(6).toString('hex')}`
}

function normalizeToolCall(call) {
  const fn = call?.function ?? {}
  const rawArgs = fn.arguments
  return {
    ...call,
    id: call?.id ?? randomCallId(),
    type: call.type ?? 'function',
    function: {
      ...fn,
      name: fn.name ?? call?.name,
      arguments:
        typeof rawArgs === 'string'
          ? rawArgs
          : rawArgs == null
            ? '{}'
            : JSON.stringify(rawArgs),
    },
  }
}

function hashNine(seed) {
  const digest = crypto.createHash('sha256').update(String(seed)).digest('hex')
  let out = ''
  for (let index = 0; out.length < 9 && index < digest.length / 2; index += 1) {
    out += parseInt(digest.slice(index * 2, index * 2 + 2), 16).toString(36)
  }
  return out.replace(/[^a-z0-9]/g, '0').slice(0, 9).padEnd(9, '0')
}

function remapToolCallIds(messages) {
  const map = new Map()
  const used = new Set()
  const remap = (id) => {
    const key = String(id ?? '')
    if (!key) return key
    if (map.has(key)) return map.get(key)
    let candidate = /^[a-zA-Z0-9]{9}$/.test(key) ? key : hashNine(key)
    let attempt = 0
    while (used.has(candidate)) {
      attempt += 1
      candidate = hashNine(`${key}:${attempt}`)
    }
    used.add(candidate)
    map.set(key, candidate)
    return candidate
  }

  return messages.map((message) => {
    if (message.role === 'assistant' && Array.isArray(message.tool_calls)) {
      return {
        ...message,
        tool_calls: message.tool_calls.map((call) => ({
          ...call,
          id: remap(call.id),
        })),
      }
    }
    if (message.role === 'tool' && message.tool_call_id != null) {
      return { ...message, tool_call_id: remap(message.tool_call_id) }
    }
    return message
  })
}

export function normalizeMessagesForProvider(messages, providerId) {
  const list = Array.isArray(messages) ? messages : []

  const systemParts = []
  const body = []
  for (const message of list) {
    if (message?.role === 'system') {
      systemParts.push(typeof message.content === 'string' ? message.content : '')
    } else if (message && typeof message === 'object') {
      body.push({ ...message })
    }
  }

  const paired = []
  let pending = []
  const flushPending = () => {
    for (const id of pending) paired.push({ role: 'tool', tool_call_id: id, content: MISSING_TOOL_RESULT })
    pending = []
  }

  for (const message of body) {
    if (message.role === 'assistant' && Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
      message.tool_calls = message.tool_calls.map(normalizeToolCall)
      flushPending()
      paired.push(message)
      pending = message.tool_calls.map((call) => call.id)
      continue
    }
    if (message.role === 'tool') {
      if (message.tool_call_id != null && pending.includes(message.tool_call_id)) {
        pending = pending.filter((id) => id !== message.tool_call_id)
        paired.push(message)
      }
      continue
    }
    flushPending()
    paired.push(message)
  }
  flushPending()

  const folded = []
  for (const message of paired) {
    const previous = folded[folded.length - 1]
    if (message.role === 'user' && previous?.role === 'tool') {
      previous.content = `${previous.content ?? ''}\n\n${message.content ?? ''}`.trim()
      continue
    }
    folded.push(message)
  }

  if (folded.length > 0 && folded[folded.length - 1].role === 'assistant') {
    folded.push({ role: 'user', content: CONTINUE_NUDGE })
  }

  const normalized = providerId === 'mistral' ? remapToolCallIds(folded) : folded
  return systemParts.length > 0
    ? [{ role: 'system', content: systemParts.filter(Boolean).join('\n\n') }, ...normalized]
    : normalized
}

export async function listProviderModels({ providerId, apiKey, onResponse = null }) {
  const provider = getProvider(providerId)
  if (!provider) throw new ProviderError(`Unknown provider "${providerId}".`, { code: 'BAD_PROVIDER' })
  const key = String(apiKey ?? '').trim()
  if (!key) throw new ProviderError('No API key is available for this provider.', { code: 'NO_KEY' })

  const response = await fetchWithTimeout(
    `${providerBaseUrl(providerId)}${provider.modelsPath}`,
    { method: 'GET', headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' } },
    LIST_TIMEOUT_MS,
  )

  if (typeof onResponse === 'function') {
    try {
      onResponse(response)
    } catch {}
  }

  if (!response.ok) {
    const { detail, code } = await readErrorDetail(response)
    throw new ProviderError(buildErrorMessage(providerId, response.status, detail), {
      status: response.status,
      code: statusCode(response.status),
      detail,
      retryAfterMs: parseRetryAfterMs(response, detail),
    })
  }

  const body = await response.json()
  return (Array.isArray(body?.data) ? body.data : [])
    .map((model) => String(model?.id ?? '').trim())
    .filter(Boolean)
}

function buildChatRequest({
  providerId,
  apiKey,
  model,
  messages,
  tools = null,
  temperature = 0.2,
  maxCompletionTokens = 2500,
  stream = false,
}) {
  const provider = getProvider(providerId)
  if (!provider) throw new ProviderError(`Unknown provider "${providerId}".`, { code: 'BAD_PROVIDER' })
  const key = String(apiKey ?? '').trim()
  const modelId = String(model ?? '').trim()
  if (!key) throw new ProviderError('No API key is available for this provider.', { code: 'NO_KEY' })
  if (!modelId) throw new ProviderError('No model was resolved for this request.', { code: 'NO_MODEL' })

  const payload = {
    model: modelId,
    messages: normalizeMessagesForProvider(messages, providerId),
    temperature,
    [provider.maxTokensParam]: maxCompletionTokens,
  }
  if (Array.isArray(tools) && tools.length > 0) {
    payload.tools = tools
    payload.tool_choice = 'auto'
  }
  if (stream) {
    payload.stream = true
    payload.stream_options = { include_usage: true }
  }

  return {
    provider,
    key,
    modelId,
    url: `${providerBaseUrl(providerId)}${provider.chatPath}`,
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(payload),
    },
  }
}

async function throwChatError(response, providerId) {
  const { detail, code, failedGeneration } = await readErrorDetail(response)
  const error = new ProviderError(buildErrorMessage(providerId, response.status, detail), {
    status: response.status,
    code: statusCode(response.status),
    detail,
    retryAfterMs: parseRetryAfterMs(response, detail),
  })
  error.failedGeneration = failedGeneration
  error.providerCode = code
  throw error
}

/**
 * One chat completion read as an SSE stream (Groq and Mistral are both
 * OpenAI-compatible). Assistant text deltas are forwarded through onDelta as
 * they arrive, and streamed tool_call fragments are accumulated per index into
 * the same { id, type, function: { name, arguments } } shape the non-streaming
 * path returns — so the caller cannot tell the two apart.
 */
export async function providerChatStream({
  providerId,
  apiKey,
  model,
  messages,
  tools = null,
  temperature = 0.2,
  maxCompletionTokens = 2500,
  onResponse = null,
  onDelta = null,
}) {
  const { url, init } = buildChatRequest({
    providerId,
    apiKey,
    model,
    messages,
    tools,
    temperature,
    maxCompletionTokens,
    stream: true,
  })

  const response = await fetchWithTimeout(url, init, REQUEST_TIMEOUT_MS)
  if (typeof onResponse === 'function') {
    try {
      onResponse(response)
    } catch {}
  }
  if (!response.ok) await throwChatError(response, providerId)
  if (!response.body) throw new ProviderError('The provider returned no stream.', { code: 'NO_STREAM' })

  const content = []
  const toolCalls = new Map()
  let lastToolKey = null
  let toolCallSeq = 0
  let usage = null
  let finishReason = null

  const absorbToolCall = (call) => {
    const id = typeof call?.id === 'string' && call.id.trim() ? call.id.trim() : null
    const name = typeof call?.function?.name === 'string' ? call.function.name : ''
    const index = Number.isInteger(call?.index) ? call.index : null
    let key = id ? `id:${id}` : index !== null ? `idx:${index}` : (lastToolKey ?? 'idx:0')
    const existing = toolCalls.get(key)
    if (name && existing?.function?.name) {
      toolCallSeq += 1
      key = `${key}#${toolCallSeq}`
    }
    const current = toolCalls.get(key) ?? {
      id: null,
      type: 'function',
      function: { name: '', arguments: '' },
    }
    if (id) current.id = id
    if (call?.type) current.type = call.type
    if (name) {
      if (!current.function.name) current.function.name = name
      else if (current.function.name !== name && !current.function.name.endsWith(name)) {
        current.function.name = name
      }
    }
    const args = call?.function?.arguments
    if (typeof args === 'string') {
      current.function.arguments += args
    } else if (args && typeof args === 'object') {
      current.function.arguments = JSON.stringify(args)
    }
    toolCalls.set(key, current)
    lastToolKey = key
  }

  const absorb = (chunk) => {
    if (chunk?.usage) usage = chunk.usage
    const choice = chunk?.choices?.[0]
    if (!choice) return
    if (choice.finish_reason) finishReason = choice.finish_reason
    const delta = choice.delta ?? {}
    if (typeof delta.content === 'string' && delta.content) {
      content.push(delta.content)
      if (typeof onDelta === 'function') {
        try {
          onDelta({ text: delta.content })
        } catch {}
      }
    }
    for (const call of Array.isArray(delta.tool_calls) ? delta.tool_calls : []) {
      absorbToolCall(call)
    }
  }

  const decoder = new TextDecoder()
  let buffer = ''
  const consumeLines = (flush) => {
    const lines = buffer.split('\n')
    buffer = flush ? '' : (lines.pop() ?? '')
    for (const rawLine of lines) {
      const line = rawLine.trim()
      if (!line || !line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (!data || data === '[DONE]') continue
      try {
        absorb(JSON.parse(data))
      } catch {
        // A keep-alive comment or a split frame: the next read completes it.
      }
    }
  }

  const reader = response.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    consumeLines(false)
  }
  buffer += decoder.decode()
  consumeLines(true)

  const message = {
    role: 'assistant',
    content: content.join(''),
  }
  const finalized = [...toolCalls.values()].filter(
    (call) => call?.function?.name || call?.function?.arguments,
  )
  if (finalized.length > 0) message.tool_calls = finalized.map(normalizeToolCall)

  return {
    choices: [{ index: 0, finish_reason: finishReason, message }],
    usage,
  }
}

export async function providerChat({
  providerId,
  apiKey,
  model,
  messages,
  tools = null,
  temperature = 0.2,
  maxCompletionTokens = 2500,
  onResponse = null,
}) {
  const { url, init } = buildChatRequest({
    providerId,
    apiKey,
    model,
    messages,
    tools,
    temperature,
    maxCompletionTokens,
  })

  const response = await fetchWithTimeout(url, init, REQUEST_TIMEOUT_MS)

  if (typeof onResponse === 'function') {
    try {
      onResponse(response)
    } catch {}
  }

  if (!response.ok) await throwChatError(response, providerId)

  const body = await response.json()
  const message = body?.choices?.[0]?.message
  if (message) body.choices[0].message = normalizeToolCallMessage(message)
  return body
}

function normalizeToolCallMessage(message) {
  if (!message || typeof message !== 'object' || !Array.isArray(message.tool_calls)) return message
  return { ...message, tool_calls: message.tool_calls.map(normalizeToolCall) }
}

export { REQUEST_TIMEOUT_MS, LIST_TIMEOUT_MS, hashNine }
