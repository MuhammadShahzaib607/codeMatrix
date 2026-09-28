export const AUTO_MODEL = 'auto'

export const AGENT_MODELS = [
  {
    id: 'mistral:mistral-large-latest',
    label: 'Mistral Large',
    provider: 'mistral',
    model: 'mistral-large-latest',
  },
  {
    id: 'mistral:codestral-latest',
    label: 'Mistral Codestral',
    provider: 'mistral',
    model: 'codestral-latest',
  },
  {
    id: 'mistral:mistral-small-latest',
    label: 'Mistral Small (fast)',
    provider: 'mistral',
    model: 'mistral-small-latest',
  },
  {
    id: 'groq:llama-3.3-70b-versatile',
    label: 'Groq llama-3.3-70b',
    provider: 'groq',
    model: 'llama-3.3-70b-versatile',
  },
  {
    id: 'groq:openai/gpt-oss-120b',
    label: 'Groq gpt-oss-120b',
    provider: 'groq',
    model: 'openai/gpt-oss-120b',
  },
  {
    id: 'groq:llama-3.1-8b-instant',
    label: 'Groq llama-3.1-8b (fast)',
    provider: 'groq',
    model: 'llama-3.1-8b-instant',
  },
]

export const PREFERRED_PROVIDERS = [
  { id: 'auto', label: 'Auto', hint: 'Prefers whichever provider has per-minute budget left' },
  { id: 'mistral', label: 'Mistral', hint: 'Run on Mistral keys' },
  { id: 'groq', label: 'Groq', hint: 'Run on Groq keys' },
]

export function providerLabelOf(providerId) {
  const id = String(providerId ?? '').trim()
  return PREFERRED_PROVIDERS.find((provider) => provider.id === id)?.label ?? 'Auto'
}

/**
 * The model options for ONE provider. Auto shows a single "Auto (recommended)"
 * entry; a concrete provider lists only its own models, with the Auto entry
 * first so the "let the server pick" choice stays reachable. Models of other
 * providers are never listed (and never rendered as disabled placeholders).
 */
export function modelsForProvider(providerId) {
  const id = String(providerId ?? '').trim()
  if (!id || id === 'auto') {
    return [
      {
        id: AUTO_MODEL,
        label: 'Auto (recommended)',
        hint: 'Picks the allowlisted model with the most remaining per-minute budget',
      },
    ]
  }
  const label = providerLabelOf(id)
  return [
    {
      id: AUTO_MODEL,
      label: `Auto (${label})`,
      hint: `Picks a ${label} model automatically`,
    },
    ...AGENT_MODELS.filter((option) => option.provider === id),
  ]
}

/** The label to show for a stored model choice under the chosen provider. */
export function modelLabelFor(id, providerId = 'auto') {
  if (!id || id === AUTO_MODEL) return modelsForProvider(providerId)[0]?.label ?? 'Auto'
  return AGENT_MODELS.find((option) => option.id === id)?.label ?? id
}

export function modelParts(id) {
  if (!id || id === AUTO_MODEL) return { provider: null, model: null }
  const option = AGENT_MODELS.find((model) => model.id === id)
  if (option?.provider && option?.model) {
    return { provider: option.provider, model: option.model }
  }
  const separator = id.indexOf(':')
  if (separator === -1) return { provider: null, model: id }
  return { provider: id.slice(0, separator), model: id.slice(separator + 1) }
}

/** True when a pinned model id belongs to the given provider. */
export function modelBelongsToProvider(id, providerId) {
  const parts = modelParts(id)
  if (!parts.model) return true
  if (!providerId || providerId === 'auto') return true
  return parts.provider === providerId
}

export function modelLabel(id) {
  if (!id || id === AUTO_MODEL) return 'Auto'
  return AGENT_MODELS.find((model) => model.id === id)?.label ?? id
}
