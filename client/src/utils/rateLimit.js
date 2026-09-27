/**
 * Helpers for the Groq rate-limit usage captured from response headers
 * (see server/src/services/usageService.js).
 *
 * A usage record looks like:
 *   { keyId, label, remainingRequests, limitRequests, remainingTokens,
 *     limitTokens, resetRequestsAt, resetTokensAt, updatedAt }
 *
 * Requests (x-ratelimit-*-requests) are a per-DAY budget; tokens
 * (x-ratelimit-*-tokens) are a per-MINUTE budget. Both are shown to the user.
 */

/** Stats for one budget ("requests" daily / "tokens" per-minute). */
export function usageStats(usage, kind = 'requests') {
  if (!usage) return null
  const isTokens = kind === 'tokens'
  const limit = isTokens ? usage.limitTokens : usage.limitRequests
  const remaining = isTokens ? usage.remainingTokens : usage.remainingRequests
  if (!Number.isFinite(limit) || limit <= 0) return null

  const safeRemaining = Number.isFinite(remaining) ? Math.max(0, remaining) : null
  const used = safeRemaining == null ? null : Math.max(0, limit - safeRemaining)
  const usedPercent = used == null ? null : Math.min(100, Math.round((used / limit) * 100))
  const remainingPercent = usedPercent == null ? null : Math.max(0, 100 - usedPercent)
  const resetAt = isTokens ? usage.resetTokensAt : usage.resetRequestsAt

  return { limit, remaining: safeRemaining, used, usedPercent, remainingPercent, resetAt }
}

/** Collapses the tone thresholds the spec asks for: <70% ok, 70-90% warn, 90%+ danger. */
export function usageTone(usedPercent) {
  if (!Number.isFinite(usedPercent)) return 'none'
  if (usedPercent >= 90) return 'danger'
  if (usedPercent >= 70) return 'warn'
  return 'ok'
}

/** A short "resets in 3m" style hint, or '' when there is no reset time. */
export function resetHint(resetAt) {
  if (!resetAt) return ''
  const diffMs = new Date(resetAt).getTime() - Date.now()
  if (!Number.isFinite(diffMs) || diffMs <= 0) return 'resets shortly'
  const seconds = Math.round(diffMs / 1000)
  if (seconds < 60) return `resets in ${seconds}s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `resets in ${minutes}m`
  const hours = Math.round(minutes / 60)
  return `resets in ${hours}h`
}
