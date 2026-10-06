import { listProviderModels, providerChat } from './providerClient.js'
import { markKeyCooling, markKeyInvalid, recordUsageEvent } from './usageService.js'

export const MAX_IMAGES = 5
export const MAX_IMAGE_BYTES = 6 * 1024 * 1024
export const MAX_REPORT_CHARS = 1200
// A vision call costs thousands of tokens per image, so it shares the key's
// per-minute token budget. On a 429 we honour the provider's Retry-After
// (bounded) once, then fall through to the next vision model, then to
// text-only — the user's images are never dropped without a message.
export const MAX_RETRY_WAIT_MS = 20000
export const TOTAL_VISION_WAIT_MS = 30000

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.round(ms))))
}

const COOLING_DEFAULT_MS = 60000
const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp'])
const DATA_URL_PATTERN = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/

// Mistral's vision-capable models, most capable first. mistral-large-latest is
// tried first and the chain falls back when a model rejects image content.
const VISION_MODEL_CANDIDATES = [
  'mistral-large-latest',
  'mistral-medium-latest',
  'mistral-small-latest',
  'pixtral-large-latest',
  'pixtral-12b-2409',
]

function asBase64Bytes(payload) {
  const clean = payload.replace(/\s+/g, '')
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((clean.length * 3) / 4) - padding)
}

export function sanitizeImagePayload(rawImages) {
  const list = Array.isArray(rawImages) ? rawImages : []
  const problems = []
  const images = []

  if (list.length > MAX_IMAGES) {
    problems.push(`Only ${MAX_IMAGES} images can be attached to one message; ${list.length - MAX_IMAGES} extra image(s) were ignored.`)
  }

  for (const entry of list.slice(0, MAX_IMAGES)) {
    const value = typeof entry === 'string' ? entry : entry?.dataUrl
    if (typeof value !== 'string' || !value) {
      problems.push('One attached image had no data and was ignored.')
      continue
    }
    const match = DATA_URL_PATTERN.exec(value.trim())
    if (!match) {
      problems.push('One attached image was not a valid png/jpeg/webp data URL and was ignored.')
      continue
    }
    const mime = match[1].toLowerCase()
    if (!ALLOWED_MIME.has(mime)) {
      problems.push(`Image type "${mime}" is not supported (use png, jpeg or webp).`)
      continue
    }
    const bytes = asBase64Bytes(match[2])
    if (bytes > MAX_IMAGE_BYTES) {
      problems.push(`One image was larger than ${Math.round(MAX_IMAGE_BYTES / (1024 * 1024))}MB and was ignored.`)
      continue
    }
    if (bytes === 0) {
      problems.push('One attached image was empty and was ignored.')
      continue
    }
    images.push({ mime, dataUrl: value.trim(), bytes })
  }

  return { images, problems }
}

function visionSystemPrompt() {
  return [
    'You are a UI/UX analyst. You look at screenshots of a web page and report defects in plain text.',
    'Return a COMPACT structured report only — never write code, HTML or CSS.',
    'Use exactly these sections, each a short bullet list:',
    'SCREENS: what each screenshot shows.',
    'PROBLEMS: the specific visual or functional problems you can see.',
    'LOCATION: the page and the section (ids or class names if they are readable).',
    'EXPECTED: what the correct result should look like.',
    'Be concrete and terse. No preamble, no code fences.',
  ].join('\n')
}

function visionUserPrompt(task) {
  const request = String(task ?? '').trim()
  return [
    'Analyze the attached screenshot(s) of a web page.',
    request ? `The user asked for: ${request}` : '',
    'Describe only what the images actually show.',
  ]
    .filter(Boolean)
    .join('\n')
}

function reportModelsFor(available) {
  if (!Array.isArray(available) || available.length === 0) return VISION_MODEL_CANDIDATES
  const set = new Set(available)
  const present = VISION_MODEL_CANDIDATES.filter((model) => set.has(model))
  return present.length > 0 ? present : VISION_MODEL_CANDIDATES
}

function isVisionRejection(error) {
  if (!error) return false
  if (error.status !== 400 && error.status !== 422) return false
  const text = `${error.message ?? ''} ${error.detail ?? ''}`.toLowerCase()
  return text.includes('image') || text.includes('vision') || text.includes('multimodal') || text.includes('content type')
}

function capReport(text) {
  const value = String(text ?? '').trim()
  if (value.length <= MAX_REPORT_CHARS) return value
  return `${value.slice(0, MAX_REPORT_CHARS)}\n[report truncated]`
}

export async function analyzeScreenshots({
  images = [],
  task = '',
  keys = [],
  userId = null,
  taskId = null,
  emitUsage = () => {},
} = {}) {
  const mistralKeys = (Array.isArray(keys) ? keys : []).filter(
    (key) => key?.plain && (key.provider ?? 'groq') === 'mistral',
  )
  if (mistralKeys.length === 0) {
    const error = new Error(
      'No vision-capable model is available: screenshots need a Mistral API key (Mistral Large / Medium / Small or Pixtral). Add one in Settings, or send the message without images.',
    )
    error.code = 'NO_VISION_MODEL'
    throw error
  }

  const content = [
    { type: 'text', text: visionUserPrompt(task) },
    ...images.map((image) => ({ type: 'image_url', image_url: image.dataUrl })),
  ]
  const messages = [
    { role: 'system', content: visionSystemPrompt() },
    { role: 'user', content },
  ]

  let lastError = null
  let waitedMs = 0
  let rateLimitRetried = false
  for (const key of mistralKeys) {
    let available = null
    try {
      available = await listProviderModels({ providerId: 'mistral', apiKey: key.plain })
    } catch {
      available = null
    }
    const models = reportModelsFor(available)
    let keyInvalid = false
    for (const model of models) {
      try {
        const response = await providerChat({
          providerId: 'mistral',
          apiKey: key.plain,
          model,
          messages,
          tools: null,
          temperature: 0.1,
          maxCompletionTokens: 500,
        })
        const raw = response?.choices?.[0]?.message?.content
        const report = capReport(typeof raw === 'string' ? raw : '')
        if (!report) {
          lastError = new Error(`${model} returned an empty analysis.`)
          continue
        }
        const summary = recordUsageEvent({
          ownerId: userId,
          keyId: key.id ?? null,
          provider: 'mistral',
          model,
          taskId,
          usage: response?.usage ?? null,
        })
        if (key.id) {
          emitUsage({
            keyId: key.id,
            provider: 'mistral',
            model,
            summary,
            at: Date.now(),
          })
        }
        return { report, model, provider: 'mistral', keyId: key.id ?? null }
      } catch (error) {
        lastError = error
        if (error.status === 401 || error.status === 403) {
          if (key.id) markKeyInvalid(key.id, error.message)
          keyInvalid = true
          break
        }
        if (error.status === 429) {
          const retryAfter =
            Number.isFinite(error.retryAfterMs) && error.retryAfterMs > 0 ? error.retryAfterMs : 0
          const step = Math.min(retryAfter || COOLING_DEFAULT_MS, MAX_RETRY_WAIT_MS)
          if (retryAfter > 0 && !rateLimitRetried && waitedMs + step <= TOTAL_VISION_WAIT_MS) {
            rateLimitRetried = true
            waitedMs += step
            lastError = new Error(
              `Mistral per-minute rate limit reached (429). Waiting ${Math.ceil(
                step / 1000,
              )}s for it to reset, then retrying ${model}.`,
            )
            await sleep(step)
            try {
              const retry = await providerChat({
                providerId: 'mistral',
                apiKey: key.plain,
                model,
                messages,
                tools: null,
                temperature: 0.1,
                maxCompletionTokens: 500,
              })
              const raw = retry?.choices?.[0]?.message?.content
              const report = capReport(typeof raw === 'string' ? raw : '')
              if (report) {
                const summary = recordUsageEvent({
                  ownerId: userId,
                  keyId: key.id ?? null,
                  provider: 'mistral',
                  model,
                  taskId,
                  usage: retry?.usage ?? null,
                })
                if (key.id) {
                  emitUsage({ keyId: key.id, provider: 'mistral', model, summary, at: Date.now() })
                }
                return { report, model, provider: 'mistral', keyId: key.id ?? null, waitedMs }
              }
            } catch (retryError) {
              lastError = retryError
            }
          }
          if (key.id) {
            markKeyCooling(
              key.id,
              retryAfter > 0 ? retryAfter : 60000,
              'Mistral rate limit reached during screenshot analysis.',
            )
          }
          continue
        }
        continue
      }
    }
    if (keyInvalid) break
  }

  const limitNote = /429|rate limit/i.test(String(lastError?.message ?? ''))
    ? ` The Mistral per-minute token limit was reached during analysis${
        waitedMs > 0 ? ` (waited ${Math.ceil(waitedMs / 1000)}s)` : ''
      } and no vision model on your key accepted the images.`
    : ''
  const error = new Error(
    `The screenshot analysis failed on every vision-capable Mistral model (${lastError?.message ?? 'no model accepted the images'}).${limitNote} Your images were not dropped, but the agent will continue text-only for now — resend in a minute or add another Mistral key in Settings.`,
  )
  error.code = 'VISION_FAILED'
  throw error
}

export const __testables = { reportModelsFor, isVisionRejection, asBase64Bytes }
