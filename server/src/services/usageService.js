import { isDatabaseConnected } from '../config/db.js'
import { modelLimits } from '../config/providers.js'
import UsageEvent from '../models/UsageEvent.model.js'

const MINUTE_MS = 60000
const EVENT_RING = 500
const UNIT_MS = { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 }

const ledgers = new Map()
const taskTotals = new Map()
const health = new Map()

export function parseDurationMs(value) {
  const text = String(value ?? '').trim()
  if (!text) return null
  if (/^\d+(\.\d+)?$/.test(text)) return Math.round(Number(text) * 1000)

  const pattern = /(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)/gi
  let total = 0
  let matched = false
  let match
  while ((match = pattern.exec(text)) !== null) {
    matched = true
    total += Number(match[1]) * (UNIT_MS[match[2].toLowerCase()] ?? 1000)
  }
  return matched ? Math.round(total) : null
}

function toNumber(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function readInt(headers, ...names) {
  for (const name of names) {
    try {
      const raw = headers?.get?.(name)
      if (raw == null || raw === '') continue
      const value = toNumber(raw)
      if (value != null) return Math.trunc(value)
    } catch {}
  }
  return null
}

function readResetAt(headers, ...names) {
  for (const name of names) {
    let raw = null
    try {
      raw = headers?.get?.(name)
    } catch {}
    const ms = parseDurationMs(raw)
    if (ms != null) return new Date(Date.now() + ms).toISOString()
  }
  return null
}

function ledgerKey(keyId, model) {
  return `${keyId}|${model}`
}

function ledgerFor({ keyId, provider, model }) {
  const id = ledgerKey(keyId, model)
  let ledger = ledgers.get(id)
  if (!ledger) {
    ledger = { keyId: String(keyId), provider: provider ?? null, model: String(model), events: [], observed: null }
    ledgers.set(id, ledger)
  }
  if (provider && !ledger.provider) ledger.provider = provider
  return ledger
}

export function markKeyInvalid(keyId, reason = 'The provider rejected this key (401).') {
  if (!keyId) return
  health.set(String(keyId), { status: 'invalid', until: null, reason, at: Date.now() })
}

export function markKeyCooling(keyId, untilMs, reason = 'Rate limit reached.') {
  if (!keyId) return
  const until = Number.isFinite(untilMs) ? new Date(Date.now() + Math.max(0, untilMs)).toISOString() : null
  health.set(String(keyId), { status: 'cooling', until, reason, at: Date.now() })
}

export function markKeyActive(keyId) {
  if (!keyId) return
  const current = health.get(String(keyId))
  if (current?.status === 'invalid') return
  health.delete(String(keyId))
}

export function getKeyHealth(keyId) {
  const entry = health.get(String(keyId))
  if (!entry) return { status: 'active', until: null, reason: null }
  if (entry.status === 'cooling' && entry.until && new Date(entry.until).getTime() <= Date.now()) {
    health.delete(String(keyId))
    return { status: 'active', until: null, reason: null }
  }
  return { status: entry.status, until: entry.until ?? null, reason: entry.reason ?? null }
}

function applyObservedHeaders(ledger, headers) {
  const observed = {
    limitTokens: readInt(headers, 'x-ratelimit-limit-tokens'),
    remainingTokens: readInt(headers, 'x-ratelimit-remaining-tokens'),
    resetTokensAt: readResetAt(headers, 'x-ratelimit-reset-tokens'),
    limitRequests: readInt(headers, 'x-ratelimit-limit-requests'),
    remainingRequests: readInt(headers, 'x-ratelimit-remaining-requests'),
    resetRequestsAt: readResetAt(headers, 'x-ratelimit-reset-requests'),
  }
  const hasAny = Object.values(observed).some((value) => value != null)
  if (!hasAny) return
  observed.at = new Date().toISOString()
  ledger.observed = observed
}

function addTaskTotals(taskId, { promptTokens, completionTokens, totalTokens }) {
  let entry = taskTotals.get(taskId)
  if (!entry) {
    entry = { taskId, promptTokens: 0, completionTokens: 0, totalTokens: 0, requests: 0 }
    taskTotals.set(taskId, entry)
  }
  entry.promptTokens += promptTokens
  entry.completionTokens += completionTokens
  entry.totalTokens += totalTokens
  entry.requests += 1
}

export function getTaskTotals(taskId) {
  if (!taskId) return null
  return taskTotals.get(String(taskId)) ?? null
}

export function clearTaskTotals(taskId) {
  if (taskId) taskTotals.delete(String(taskId))
}

function sumSince(events, since, now) {
  let tokens = 0
  let requests = 0
  for (const event of events) {
    if (event.at >= since) {
      tokens += event.totalTokens
      requests += 1
    }
  }
  return { tokens, requests }
}

export function recordObservedHeaders({ keyId, provider, model, headers }) {
  if (!keyId || !model || !headers) return null
  const ledger = ledgerFor({ keyId, provider, model })
  applyObservedHeaders(ledger, headers)
  return getUsageSummary({ keyId, provider: provider ?? ledger.provider, model })
}

export function getUsageSummary({ keyId, provider, model }) {
  if (!keyId || !model) return null
  const ledger = ledgerFor({ keyId, provider, model })
  const limits = modelLimits(provider ?? ledger.provider, model)
  const observed = ledger.observed
  const now = Date.now()
  const date = new Date()
  const startOfDay = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  const startOfMonth = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)

  const minute = sumSince(ledger.events, now - MINUTE_MS, now)
  const today = sumSince(ledger.events, startOfDay, now)
  const month = sumSince(ledger.events, startOfMonth, now)

  const effectiveLimits = {
    tpm: observed?.limitTokens ?? limits.tpm ?? null,
    rpm: observed?.limitRequests ?? limits.rpm ?? null,
    rpd: limits.rpd ?? null,
    monthlyTokens: limits.monthlyTokens ?? null,
    maxOutput: limits.maxOutput ?? null,
  }

  const providerReported = observed
    ? {
        remainingTokens: observed.remainingTokens,
        resetTokensAt: observed.resetTokensAt,
        remainingRequests: observed.remainingRequests,
        resetRequestsAt: observed.resetRequestsAt,
        observedAt: observed.at,
      }
    : null

  return {
    keyId: String(keyId),
    provider: provider ?? ledger.provider ?? null,
    model: String(model),
    limits: effectiveLimits,
    tokensLastMinute: minute.tokens,
    requestsLastMinute: minute.requests,
    requestsToday: today.requests,
    tokensToday: today.tokens,
    tokensThisMonth: month.tokens,
    providerReported,
    countedLocally: !observed,
    lastUpdated: new Date(now).toISOString(),
  }
}

export function remainingPerMinute({ keyId, orgKey, provider, providerId, model }) {
  const summary = getUsageSummary({ keyId: keyId ?? orgKey, provider: provider ?? providerId, model })
  if (!summary) return Number.POSITIVE_INFINITY
  const budget = summary.limits.tpm ?? Number.POSITIVE_INFINITY
  const used = summary.tokensLastMinute + (summary.requestsLastMinute + 1) * 400
  return Math.max(0, budget - used)
}

export function recordUsageEvent({
  ownerId = null,
  keyId,
  provider = null,
  model,
  taskId = null,
  usage = null,
  headers = null,
} = {}) {
  if (!keyId || !model) return null
  const promptTokens = toNumber(usage?.prompt_tokens) ?? 0
  const completionTokens = toNumber(usage?.completion_tokens) ?? 0
  const reportedTotal = toNumber(usage?.total_tokens)
  const totalTokens = reportedTotal ?? promptTokens + completionTokens

  const ledger = ledgerFor({ keyId, provider, model })
  ledger.events.push({ at: Date.now(), promptTokens, completionTokens, totalTokens })
  if (ledger.events.length > EVENT_RING) {
    ledger.events.splice(0, ledger.events.length - EVENT_RING)
  }
  if (headers) applyObservedHeaders(ledger, headers)
  if (taskId) addTaskTotals(taskId, { promptTokens, completionTokens, totalTokens })

  persistEvent({ ownerId, keyId, provider: provider ?? ledger.provider, model, taskId, promptTokens, completionTokens, totalTokens })

  return getUsageSummary({ keyId, provider: provider ?? ledger.provider, model })
}

function persistEvent(event) {
  if (!isDatabaseConnected() || !event.ownerId) return
  Promise.resolve(
    UsageEvent.create({
      owner: event.ownerId,
      keyId: String(event.keyId),
      provider: event.provider ?? 'groq',
      model: event.model,
      taskId: event.taskId ?? null,
      promptTokens: event.promptTokens,
      completionTokens: event.completionTokens,
      totalTokens: event.totalTokens,
      createdAt: new Date(),
    }),
  ).catch((error) => {
    console.warn(`[usage] could not persist event for ${event.keyId}: ${error.message}`)
  })
}

function modelsForKey(keyId) {
  const models = []
  for (const ledger of ledgers.values()) {
    if (String(ledger.keyId) === String(keyId) && !models.includes(ledger.model)) {
      models.push(ledger.model)
    }
  }
  return models
}

export async function hydrateUsage(keys = []) {
  if (!isDatabaseConnected()) return
  const since = new Date(Date.now() - 31 * 86400000)
  for (const key of keys) {
    if (!key?.id) continue
    const known = [...ledgers.values()].filter((ledger) => String(ledger.keyId) === String(key.id))
    if (known.some((ledger) => ledger.events.length > 0)) continue
    let docs
    try {
      docs = await UsageEvent.find({ keyId: String(key.id), createdAt: { $gte: since } })
        .sort({ createdAt: 1 })
        .lean()
    } catch {
      continue
    }
    for (const doc of docs) {
      const ledger = ledgerFor({ keyId: key.id, provider: doc.provider ?? key.provider, model: doc.model })
      ledger.events.push({
        at: new Date(doc.createdAt).getTime(),
        promptTokens: doc.promptTokens ?? 0,
        completionTokens: doc.completionTokens ?? 0,
        totalTokens: doc.totalTokens ?? 0,
      })
    }
    if (docs.length > 0) {
      for (const ledger of ledgers.values()) {
        if (ledger.events.length > EVENT_RING) {
          ledger.events.splice(0, ledger.events.length - EVENT_RING)
        }
      }
    }
  }
}

export function latestModelFor(keyId) {
  let best = null
  for (const ledger of ledgers.values()) {
    if (String(ledger.keyId) !== String(keyId)) continue
    const last = ledger.events[ledger.events.length - 1]
    if (!last) continue
    if (!best || last.at > best.at) best = { model: ledger.model, at: last.at }
  }
  return best?.model ?? null
}

export function getUsageForKey(key, { models = null } = {}) {
  const list = models ?? modelsForKey(key.id)
  const provider = key.provider ?? 'groq'
  const byModel = {}
  for (const model of list) {
    const summary = getUsageSummary({ keyId: key.id, provider, model })
    if (summary) byModel[model] = summary
  }
  const preferredModel = latestModelFor(key.id) ?? list[0] ?? null
  const summary = preferredModel ? byModel[preferredModel] ?? null : null
  const lastUpdated = Object.values(byModel).reduce(
    (latest, entry) => (!latest || entry.lastUpdated > latest ? entry.lastUpdated : latest),
    null,
  )
  return { models: byModel, summary, preferredModel, lastUpdated }
}

export function providerFor(keyId) {
  for (const ledger of ledgers.values()) {
    if (String(ledger.keyId) === String(keyId)) return ledger.provider
  }
  return null
}

export const __testables = { parseDurationMs, ledgerKey }
