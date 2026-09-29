const EXCLUDED_MODEL_PATTERNS = [
  /safeguard/i,
  /prompt-?guard/i,
  /\bguard\b/i,
  /whisper/i,
  /(^|[-_/])tts([-_/]|$)/i,
  /text-to-speech/i,
  /orpheus/i,
  /embed/i,
  /moderation/i,
  /shieldstral/i,
  /voxtral/i,
  /transcribe/i,
  /(^|[-_/])ocr([-_/]|$)/i,
  /pixtral/i,
  /magistral/i,
  /leanstral/i,
]

export function isExcludedModel(modelId) {
  const id = String(modelId ?? '').trim()
  if (!id) return true
  return EXCLUDED_MODEL_PATTERNS.some((pattern) => pattern.test(id))
}

const GROQ_LIMITS = {
  'openai/gpt-oss-120b': { tpm: 8000, rpm: 30, rpd: 1000, maxOutput: 32768 },
  'openai/gpt-oss-20b': { tpm: 8000, rpm: 30, rpd: 1000, maxOutput: 32768 },
  'qwen/qwen3.8-27b': { tpm: 8000, rpm: 30, rpd: 1000, maxOutput: 32768 },
  'llama-3.3-70b-versatile': { tpm: 12000, rpm: 30, rpd: 1000, maxOutput: 8192 },
  'llama-3.1-8b-instant': { tpm: 6000, rpm: 30, rpd: 14400, maxOutput: 8192 },
  'moonshotai/kimi-k2-instruct-0905': { tpm: 8000, rpm: 30, rpd: 1000, maxOutput: 16384 },
}

const MISTRAL_LIMITS = {
  'mistral-large-latest': { tpm: 500000, rpm: 60, rpd: null, monthlyTokens: 1000000000, maxOutput: 32768 },
  'mistral-small-latest': { tpm: 500000, rpm: 60, rpd: null, monthlyTokens: 1000000000, maxOutput: 32768 },
  'codestral-latest': { tpm: 500000, rpm: 60, rpd: null, monthlyTokens: 1000000000, maxOutput: 32768 },
}

export const PROVIDERS = {
  groq: {
    id: 'groq',
    label: 'Groq',
    keyHint: 'gsk_…',
    keyUrl: 'https://console.groq.com/keys',
    docsUrl: 'https://console.groq.com/docs',
    baseUrl: 'https://api.groq.com/openai/v1',
    modelsPath: '/models',
    chatPath: '/chat/completions',
    maxTokensParam: 'max_completion_tokens',
    supportsRetryAfterHeader: true,
    localCounting: false,
    toolCapableModels: [
      'openai/gpt-oss-120b',
      'openai/gpt-oss-20b',
      'qwen/qwen3.8-27b',
      'llama-3.3-70b-versatile',
      'llama-3.1-8b-instant',
      'moonshotai/kimi-k2-instruct-0905',
    ],
    limitsByModel: GROQ_LIMITS,
    defaults: {
      tpm: 8000,
      rpm: 30,
      rpd: 1000,
      monthlyTokens: null,
      maxOutput: 8192,
      contextWindow: 131072,
    },
  },

  mistral: {
    id: 'mistral',
    label: 'Mistral',
    keyHint: 'your Mistral API key',
    keyUrl: 'https://console.mistral.ai/api-keys',
    docsUrl: 'https://docs.mistral.ai/studio/conversations/function-calling',
    notice:
      'Free Experiment plan requests may be used by Mistral for model training. Do not send sensitive code.',
    baseUrl: 'https://api.mistral.ai/v1',
    modelsPath: '/models',
    chatPath: '/chat/completions',
    maxTokensParam: 'max_tokens',
    supportsRetryAfterHeader: true,
    localCounting: true,
    toolCapableModels: ['mistral-large-latest', 'mistral-small-latest', 'codestral-latest'],
    limitsByModel: MISTRAL_LIMITS,
    defaults: {
      tpm: 500000,
      rpm: 60,
      rpd: null,
      monthlyTokens: 1000000000,
      maxOutput: 32768,
      contextWindow: 131072,
    },
  },
}

export const DEFAULT_PROVIDER_ORDER = ['mistral', 'groq']

export const PREFERRED_PROVIDER_CHOICES = [
  { id: 'auto', label: 'Auto', hint: 'Uses whichever provider has the most remaining per-minute budget' },
  { id: 'mistral', label: 'Mistral first', hint: 'Tries Mistral keys before Groq' },
  { id: 'groq', label: 'Groq first', hint: 'Tries Groq keys before Mistral' },
]

export function getProvider(providerId) {
  return PROVIDERS[String(providerId ?? '').trim()] ?? null
}

export function providerLabel(providerId) {
  return getProvider(providerId)?.label ?? String(providerId ?? 'Unknown')
}

export function isKnownProvider(providerId) {
  return Boolean(getProvider(providerId))
}

export function providerBaseUrl(providerId) {
  const provider = getProvider(providerId)
  if (!provider) return ''
  const override = String(process.env[`${providerId.toUpperCase()}_BASE_URL`] ?? '')
    .trim()
    .replace(/\/+$/, '')
  return override || provider.baseUrl
}

export const CODE_ONLY_MODELS = ['codestral-latest']

export function isCodeOnlyModel(modelId) {
  return CODE_ONLY_MODELS.includes(String(modelId ?? '').trim())
}

export const PREFERRED_AGENT_MODEL = {
  mistral: 'mistral-large-latest',
  groq: 'openai/gpt-oss-120b',
}

export function modelNote(providerId, modelId) {
  const id = String(modelId ?? '').trim()
  if (!id) return ''
  if (isCodeOnlyModel(id)) {
    return 'code completion only — weak tool use and not recommended for agent runs'
  }
  if (id === PREFERRED_AGENT_MODEL[providerId]) return 'recommended for agent runs'
  return ''
}

export function isAllowedModel(providerId, modelId) {
  const provider = getProvider(providerId)
  if (!provider) return false
  const id = String(modelId ?? '').trim()
  if (!id || isExcludedModel(id)) return false
  return provider.toolCapableModels.includes(id)
}

export function allowedModelsFor(providerId) {
  const provider = getProvider(providerId)
  return provider ? [...provider.toolCapableModels] : []
}

export function modelLimits(providerId, modelId) {
  const provider = getProvider(providerId)
  if (!provider) {
    return {
      tpm: 6000,
      rpm: 30,
      rpd: 1000,
      monthlyTokens: null,
      maxOutput: 8192,
      contextWindow: 131072,
    }
  }
  const specific = provider.limitsByModel?.[String(modelId ?? '').trim()]
  return { ...provider.defaults, ...(specific ?? {}) }
}

export function modelCapability(modelId) {
  const id = String(modelId ?? '').toLowerCase()
  let score = 0
  const size = id.match(/(\d+(?:\.\d+)?)\s*b\b/)
  if (size) score += Number(size[1])
  if (/\bpro\b/.test(id)) score += 40
  if (/\bmedium\b/.test(id)) score += 30
  if (/\blarge\b/.test(id)) score += 35
  if (/flash/.test(id)) score += 20
  if (/codestral|devstral|kimi|qwen/.test(id)) score += 10
  if (/oss-120b|gpt-oss/.test(id)) score += 25
  return score
}

export function modelRank(providerId, modelId) {
  const provider = getProvider(providerId)
  if (!provider) return Number.MAX_SAFE_INTEGER
  const index = provider.toolCapableModels.indexOf(String(modelId ?? '').trim())
  return index === -1 ? Number.MAX_SAFE_INTEGER : index
}

export function providerPublicConfig() {
  return DEFAULT_PROVIDER_ORDER.map((id) => {
    const provider = PROVIDERS[id]
    return {
      id,
      label: provider.label,
      keyHint: provider.keyHint,
      keyUrl: provider.keyUrl,
      docsUrl: provider.docsUrl,
      notice: provider.notice ?? null,
      supportsRetryAfterHeader: provider.supportsRetryAfterHeader,
      localCounting: provider.localCounting,
      models: [...provider.toolCapableModels],
      defaults: { ...provider.defaults },
    }
  })
}
