export const AUTO_MODEL = 'auto'

export const AGENT_MODELS = [
  {
    id: AUTO_MODEL,
    label: 'Auto (recommended)',
    hint: 'Picks the allowlisted model with the most remaining per-minute budget',
  },
  {
    id: 'mistral:mistral-large-latest',
    label: 'Mistral · large',
    provider: 'mistral',
    model: 'mistral-large-latest',
  },
  {
    id: 'mistral:mistral-small-latest',
    label: 'Mistral · small (fast)',
    provider: 'mistral',
    model: 'mistral-small-latest',
  },
  {
    id: 'mistral:codestral-latest',
    label: 'Mistral · codestral',
    provider: 'mistral',
    model: 'codestral-latest',
  },
  {
    id: 'groq:llama-3.3-70b-versatile',
    label: 'Groq · llama-3.3-70b',
    provider: 'groq',
    model: 'llama-3.3-70b-versatile',
  },
  {
    id: 'groq:llama-3.1-8b-instant',
    label: 'Groq · llama-3.1-8b (fast)',
    provider: 'groq',
    model: 'llama-3.1-8b-instant',
  },
  {
    id: 'groq:openai/gpt-oss-120b',
    label: 'Groq · gpt-oss-120b',
    provider: 'groq',
    model: 'openai/gpt-oss-120b',
  },
]

export const PREFERRED_PROVIDERS = [
  { id: 'auto', label: 'Auto', hint: 'Prefers the provider with the most remaining budget' },
  { id: 'mistral', label: 'Mistral first', hint: 'Try Mistral keys before Groq' },
  { id: 'groq', label: 'Groq first', hint: 'Try Groq keys before Mistral' },
]

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

export function modelLabel(id) {
  if (!id || id === AUTO_MODEL) return 'Auto'
  return AGENT_MODELS.find((model) => model.id === id)?.label ?? id
}
