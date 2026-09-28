import { getUsageSummary } from './usageService.js'

const WINDOW_MS = 60000
const DEFAULT_MAX_COMPLETION = 2500
const MIN_COMPLETION = 800

export function estimateTokens(messages, tools = null) {
  let chars = 0
  for (const message of messages ?? []) {
    if (typeof message?.content === 'string') chars += message.content.length
    if (Array.isArray(message?.tool_calls)) {
      for (const call of message.tool_calls) {
        chars += Number(call?.function?.arguments?.length ?? 0) + 24
      }
    }
    chars += 12
  }
  if (Array.isArray(tools)) chars += JSON.stringify(tools).length
  return Math.max(1, Math.ceil(chars / 4))
}

function resolveWindow({ key, limits, summary }) {
  const resolved =
    summary ??
    (key?.orgKey
      ? getUsageSummary({ keyId: key.orgKey, provider: key.providerId, model: key.model })
      : null)
  const tpm = resolved?.limits?.tpm ?? limits?.tpm ?? 6000
  const observedRemaining = resolved?.providerReported?.remainingTokens
  const used = resolved?.tokensLastMinute ?? 0
  const remaining = observedRemaining != null ? Math.max(0, observedRemaining) : Math.max(0, tpm - used)
  const resetAt = resolved?.providerReported?.resetTokensAt
    ? new Date(resolved.providerReported.resetTokensAt).getTime()
    : null
  const resetMs = resetAt && resetAt > Date.now() ? resetAt - Date.now() : WINDOW_MS
  return { tpm, remaining, resetMs, used }
}

export function planRequest({
  key = null,
  limits = null,
  estimatedInput = 0,
  desiredMax = DEFAULT_MAX_COMPLETION,
  summary = null,
} = {}) {
  const window = resolveWindow({ key, limits, summary })
  const margin = Math.max(150, Math.round(window.tpm * 0.1))
  const headroom = window.remaining - margin

  if (estimatedInput >= headroom) {
    return {
      ok: false,
      waitMs: window.resetMs,
      maxCompletionTokens: 0,
      shrinkHistory: true,
      remaining: window.remaining,
    }
  }

  const maxCompletionTokens = Math.min(desiredMax, headroom - estimatedInput)
  if (maxCompletionTokens < MIN_COMPLETION) {
    return {
      ok: false,
      waitMs: window.resetMs,
      maxCompletionTokens: 0,
      shrinkHistory: true,
      remaining: window.remaining,
    }
  }

  return {
    ok: true,
    waitMs: 0,
    maxCompletionTokens: Math.floor(maxCompletionTokens),
    shrinkHistory: false,
    remaining: window.remaining,
  }
}

export function resetBuckets() {}

export const __testables = { WINDOW_MS, MIN_COMPLETION, DEFAULT_MAX_COMPLETION }
