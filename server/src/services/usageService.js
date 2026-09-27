import { isDatabaseConnected } from '../config/db.js'
import ApiKeyUsage from '../models/ApiKeyUsage.model.js'

/**
 * Live Groq rate-limit usage.
 *
 * EVERY Groq HTTP response carries the account's current limit state in
 * headers:
 *   x-ratelimit-limit-requests, x-ratelimit-remaining-requests,
 *   x-ratelimit-limit-tokens,   x-ratelimit-remaining-tokens,
 *   x-ratelimit-reset-requests, x-ratelimit-reset-tokens
 *
 * After each agent request we parse them and remember the LATEST values per
 * saved API key, so Settings and the AI panel can show how much budget is left
 * WITHOUT making a fresh Groq call just to look.
 *
 * Storage is a two-tier cache:
 *   1. an always-present in-memory Map (fast, and works with no database), and
 *   2. a best-effort MongoDB upsert (ApiKeyUsage) so the numbers survive a
 *      server restart when a database is connected.
 * The in-memory copy is authoritative for a running process; the database is a
 * durable mirror. A key that has never made a request has no record at all, and
 * the UI shows a neutral "Not used yet" state for it.
 */

const UNIT_MS = { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 }

// keyId -> usage record (the same shape stored in MongoDB).
const cache = new Map()

/**
 * Groq writes reset windows as durations ("1m2.4s", "2.5s", "1h", "350ms") and
 * occasionally as plain seconds. Returns milliseconds, or null when unparsable.
 */
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

function readInt(headers, name) {
  try {
    const raw = headers?.get?.(name)
    if (raw == null || raw === '') return null
    const value = Number(raw)
    return Number.isFinite(value) ? Math.trunc(value) : null
  } catch {
    return null
  }
}

function readResetAt(headers, name) {
  const ms = parseDurationMs(headers?.get?.(name))
  if (ms == null) return null
  return new Date(Date.now() + ms).toISOString()
}

/**
 * Parses the rate-limit headers of ONE Groq response into a usage record and
 * stores it as the latest value for `keyId`. Returns the record (for streaming
 * to the client), or null when there is nothing usable to store.
 *
 * `headers` is a WHATWG Headers object (fetch Response.headers).
 */
export function recordUsageFromHeaders({ keyId, userId = null, label = '', headers } = {}) {
  if (!keyId) return null

  const limitRequests = readInt(headers, 'x-ratelimit-limit-requests')
  const remainingRequests = readInt(headers, 'x-ratelimit-remaining-requests')
  const limitTokens = readInt(headers, 'x-ratelimit-limit-tokens')
  const remainingTokens = readInt(headers, 'x-ratelimit-remaining-tokens')

  // No rate-limit headers at all (e.g. a local test stand-in): nothing to show.
  if (
    limitRequests == null &&
    remainingRequests == null &&
    limitTokens == null &&
    remainingTokens == null
  ) {
    return null
  }

  const record = {
    keyId: String(keyId),
    userId: userId ? String(userId) : null,
    label: String(label ?? ''),
    remainingRequests,
    limitRequests,
    remainingTokens,
    limitTokens,
    resetRequestsAt: readResetAt(headers, 'x-ratelimit-reset-requests'),
    resetTokensAt: readResetAt(headers, 'x-ratelimit-reset-tokens'),
    updatedAt: new Date().toISOString(),
  }

  cache.set(record.keyId, record)
  persist(record)
  return record
}

/** Best-effort durable mirror; never blocks or throws into the agent loop. */
function persist(record) {
  if (!isDatabaseConnected() || !record.userId) return
  Promise.resolve(
    ApiKeyUsage.findOneAndUpdate(
      { keyId: record.keyId },
      { $set: record },
      { upsert: true, setDefaultsOnInsert: true },
    ),
  ).catch((error) => {
    console.warn(`[usage] could not persist usage for ${record.keyId}: ${error.message}`)
  })
}

/** Drops Mongo-only fields so a hydrated record matches the in-memory shape. */
function toRecord(doc) {
  return {
    keyId: String(doc.keyId),
    userId: doc.userId ?? null,
    label: doc.label ?? '',
    remainingRequests: doc.remainingRequests ?? null,
    limitRequests: doc.limitRequests ?? null,
    remainingTokens: doc.remainingTokens ?? null,
    limitTokens: doc.limitTokens ?? null,
    resetRequestsAt: doc.resetRequestsAt ?? null,
    resetTokensAt: doc.resetTokensAt ?? null,
    updatedAt: doc.updatedAt ?? null,
  }
}

/** The latest captured usage for one key, or null when it has never been used. */
export function getUsage(keyId) {
  return cache.get(String(keyId)) ?? null
}

function cachedUsageForKeys(keyIds) {
  const result = new Map()
  for (const id of keyIds) {
    const record = cache.get(String(id))
    if (record) result.set(String(id), record)
  }
  return result
}

/**
 * The latest usage for a set of keys, as a Map keyed by keyId. Keys with no
 * captured usage are simply absent (the UI shows "Not used yet").
 *
 * Anything missing from the in-memory cache is hydrated from the MongoDB mirror
 * when a database is connected, so numbers captured before a restart are still
 * shown. Hydrated records are folded back into the cache.
 */
export async function getUsageForKeys(keyIds = []) {
  const result = cachedUsageForKeys(keyIds)
  const missing = keyIds.map(String).filter((id) => !result.has(id))
  if (missing.length === 0 || !isDatabaseConnected()) return result

  try {
    const docs = await ApiKeyUsage.find({ keyId: { $in: missing } }).lean()
    for (const doc of docs) {
      const record = toRecord(doc)
      cache.set(record.keyId, record)
      result.set(record.keyId, record)
    }
  } catch (error) {
    console.warn(`[usage] could not load persisted usage: ${error.message}`)
  }

  return result
}

export const __testables = { parseDurationMs }
