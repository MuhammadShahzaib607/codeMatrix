export function usageTone(usedPercent) {
  if (!Number.isFinite(usedPercent)) return 'none'
  if (usedPercent >= 100) return 'exhausted'
  if (usedPercent >= 90) return 'danger'
  if (usedPercent >= 70) return 'warn'
  return 'ok'
}

export function formatCompact(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  const abs = Math.abs(n)
  if (abs >= 1e9) return `${(n / 1e9).toFixed(n % 1e9 === 0 ? 0 : 1)}B`
  if (abs >= 1e6) return `${(n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 1)}M`
  if (abs >= 1e3) return `${(n / 1e3).toFixed(n % 1e3 === 0 ? 0 : 1)}K`
  return String(Math.round(n))
}

export function resetHint(resetAt) {
  if (!resetAt) return ''
  const diffMs = new Date(resetAt).getTime() - Date.now()
  if (!Number.isFinite(diffMs) || diffMs <= 0) return 'resets shortly'
  const seconds = Math.round(diffMs / 1000)
  if (seconds < 60) return `resets in ${seconds}s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `resets in ${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `resets in ${hours}h`
  return `resets in ${Math.round(hours / 24)}d`
}

function meter(used, limit, resetAt, countedLocally) {
  if (!Number.isFinite(limit) || limit <= 0) return null
  const safeUsed = Math.max(0, Number(used) || 0)
  const usedPercent = Math.min(100, Math.round((safeUsed / limit) * 100))
  return {
    used: safeUsed,
    limit,
    usedPercent,
    remaining: Math.max(0, limit - safeUsed),
    remainingPercent: Math.max(0, 100 - usedPercent),
    tone: usageTone(usedPercent),
    resetAt: resetAt ?? null,
    countedLocally: Boolean(countedLocally),
  }
}

export function usageMeters(summary, providerId) {
  if (!summary) return null
  const limits = summary.limits ?? {}
  const reported = summary.providerReported ?? {}
  const isMistral = providerId === 'mistral'

  const minute = meter(
    summary.tokensLastMinute,
    limits.tpm,
    reported.resetTokensAt,
    summary.countedLocally,
  )
  const secondary = isMistral
    ? meter(summary.tokensThisMonth, limits.monthlyTokens, null, summary.countedLocally)
    : meter(summary.requestsToday, limits.rpd, reported.resetRequestsAt, summary.countedLocally)

  const minutePercent = minute?.usedPercent ?? 0
  const secondaryPercent = secondary?.usedPercent ?? 0
  const tighter = minutePercent >= secondaryPercent ? minute : secondary

  return {
    isMistral,
    minute,
    secondary,
    secondaryLabel: isMistral ? 'Tokens this month' : 'Requests today',
    tighter,
    reported,
  }
}

export function keyStatusLabel(status) {
  if (!status || status.status === 'active') return { label: 'Active', tone: 'ok' }
  if (status.status === 'invalid') return { label: 'Invalid', tone: 'danger' }
  const seconds = status.until
    ? Math.max(0, Math.round((new Date(status.until).getTime() - Date.now()) / 1000))
    : 0
  return { label: `Cooling down ${seconds}s`, tone: 'warn' }
}
