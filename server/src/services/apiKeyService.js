import mongoose from 'mongoose'
import { isDatabaseConnected } from '../config/db.js'
import { DEFAULT_PROVIDER_ORDER, getProvider, isKnownProvider, providerLabel } from '../config/providers.js'
import { ApiKey } from '../models/ApiKey.model.js'
import User from '../models/User.model.js'
import ApiError from '../utils/ApiError.js'
import { decryptSecret, encryptSecret, maskSecret } from '../utils/keyVault.js'
import { listProviderModels } from './providerClient.js'

export const MAX_KEYS_PER_PROVIDER = 3
export const MAX_KEYS_PER_USER = MAX_KEYS_PER_PROVIDER * DEFAULT_PROVIDER_ORDER.length

function requireDatabase() {
  if (!isDatabaseConnected()) {
    throw new ApiError(
      503,
      'API keys are unavailable because the server has no database configured.',
      'KEYS_UNAVAILABLE',
    )
  }
}

function toPublic(doc) {
  let masked = '••••'
  try {
    masked = maskSecret(decryptSecret(doc.encryptedKey))
  } catch {
    masked = '????'
  }
  return {
    id: String(doc._id),
    provider: doc.provider || 'groq',
    providerLabel: providerLabel(doc.provider),
    label: doc.label || '',
    masked,
    createdAt: doc.createdAt ?? null,
  }
}

export async function listKeysForUser(ownerId) {
  requireDatabase()
  const docs = await ApiKey.find({ owner: ownerId }).sort({ createdAt: -1 }).lean()
  return docs.map(toPublic)
}

export async function saveKeyForUser(ownerId, { provider = 'groq', key, label = '' } = {}) {
  requireDatabase()
  const providerId = String(provider || 'groq').trim()
  if (!isKnownProvider(providerId)) {
    throw new ApiError(400, `Unsupported provider "${providerId}".`, 'PROVIDER_INVALID')
  }

  const raw = String(key ?? '').trim()
  if (!raw) {
    throw new ApiError(400, `An ${providerLabel(providerId)} API key is required.`, 'KEY_REQUIRED')
  }
  if (/\s/.test(raw) || raw.length < 12) {
    throw new ApiError(400, 'That does not look like a valid API key.', 'KEY_INVALID')
  }

  const existing = await ApiKey.countDocuments({ owner: ownerId, provider: providerId })
  if (existing >= MAX_KEYS_PER_PROVIDER) {
    throw new ApiError(
      400,
      `Maximum ${MAX_KEYS_PER_PROVIDER} ${providerLabel(providerId)} keys allowed. Delete one before adding another.`,
      'KEY_LIMIT_REACHED',
    )
  }

  let verified = true
  try {
    await listProviderModels({ providerId, apiKey: raw })
  } catch (error) {
    verified = false
    if (error.status === 401 || error.status === 403) {
      throw new ApiError(
        400,
        `${providerLabel(providerId)} rejected that key (${error.status}). Check it and try again.`,
        'KEY_REJECTED',
      )
    }
    if (error.status && error.status >= 400 && error.status < 500) {
      throw new ApiError(400, error.message, 'KEY_REJECTED')
    }
  }

  const doc = await ApiKey.create({
    owner: ownerId,
    provider: providerId,
    label: String(label ?? '').trim().slice(0, 60),
    encryptedKey: encryptSecret(raw),
    createdAt: new Date(),
  })
  return { ...toPublic(doc), verified }
}

export async function deleteKeyForUser(ownerId, keyId) {
  requireDatabase()
  const result = await ApiKey.deleteOne({ _id: keyId, owner: ownerId })
  return result.deletedCount > 0
}

export async function verifyAccountPassword(userId, password) {
  requireDatabase()
  const candidate = typeof password === 'string' ? password : ''
  if (!candidate) {
    throw new ApiError(401, 'Enter your account password to continue.', 'PASSWORD_REQUIRED')
  }
  const user = await User.findById(userId)
  if (!user) {
    throw new ApiError(404, 'That account no longer exists.', 'USER_NOT_FOUND')
  }
  const isValid = await user.comparePassword(candidate)
  if (!isValid) {
    throw new ApiError(401, 'Incorrect password. Your API key was not revealed.', 'INVALID_PASSWORD')
  }
}

export async function revealKeyForUser(ownerId, keyId) {
  requireDatabase()
  if (!mongoose.isValidObjectId(keyId)) {
    throw new ApiError(404, 'API key not found.', 'KEY_NOT_FOUND')
  }
  const doc = await ApiKey.findOne({ _id: keyId, owner: ownerId })
  if (!doc) {
    throw new ApiError(404, 'API key not found.', 'KEY_NOT_FOUND')
  }
  try {
    return {
      id: String(doc._id),
      provider: doc.provider || 'groq',
      label: doc.label || '',
      value: decryptSecret(doc.encryptedKey),
    }
  } catch {
    throw new ApiError(
      500,
      'That saved key could not be decrypted (ENCRYPTION_SECRET changed?). Delete it and add the key again.',
      'KEY_DECRYPT_FAILED',
    )
  }
}

export async function updateKeyForUser(ownerId, keyId, { label, key } = {}) {
  requireDatabase()
  if (!mongoose.isValidObjectId(keyId)) {
    throw new ApiError(404, 'API key not found.', 'KEY_NOT_FOUND')
  }
  const doc = await ApiKey.findOne({ _id: keyId, owner: ownerId })
  if (!doc) {
    throw new ApiError(404, 'API key not found.', 'KEY_NOT_FOUND')
  }

  if (typeof label === 'string') {
    doc.label = label.trim().slice(0, 60)
  }

  if (typeof key === 'string' && key.trim()) {
    const raw = key.trim()
    if (/\s/.test(raw) || raw.length < 12) {
      throw new ApiError(400, 'That does not look like a valid API key.', 'KEY_INVALID')
    }
    try {
      await listProviderModels({ providerId: doc.provider || 'groq', apiKey: raw })
    } catch (error) {
      if (error.status === 401 || error.status === 403) {
        throw new ApiError(400, 'The provider rejected that key.', 'KEY_REJECTED')
      }
    }
    doc.encryptedKey = encryptSecret(raw)
  }

  await doc.save()
  return toPublic(doc)
}

export async function resolveKeysForUser(ownerId, preferredKeyId = null) {
  requireDatabase()
  if (preferredKeyId && !mongoose.isValidObjectId(preferredKeyId)) {
    throw new ApiError(404, 'API key not found.', 'KEY_NOT_FOUND')
  }

  const docs = await ApiKey.find({ owner: ownerId }).sort({ createdAt: -1 }).lean()
  if (docs.length === 0) {
    throw new ApiError(
      404,
      'No API key saved yet. Add one in Settings -> AI to use the assistant.',
      'NO_KEYS',
    )
  }

  let ordered = docs
  if (preferredKeyId) {
    const preferredId = String(preferredKeyId)
    const preferred = docs.find((doc) => String(doc._id) === preferredId)
    if (!preferred) {
      throw new ApiError(404, 'API key not found.', 'KEY_NOT_FOUND')
    }
    ordered = [preferred, ...docs.filter((doc) => String(doc._id) !== preferredId)]
  }

  const providerRank = (doc) => {
    const index = DEFAULT_PROVIDER_ORDER.indexOf(doc.provider || 'groq')
    return index === -1 ? DEFAULT_PROVIDER_ORDER.length : index
  }
  ordered = [...ordered].sort((a, b) => {
    const aPreferred = preferredKeyId && String(a._id) === String(preferredKeyId) ? 0 : 1
    const bPreferred = preferredKeyId && String(b._id) === String(preferredKeyId) ? 0 : 1
    if (aPreferred !== bPreferred) return aPreferred - bPreferred
    return providerRank(a) - providerRank(b)
  })

  return ordered.map((doc) => {
    try {
      return {
        id: String(doc._id),
        label: doc.label || '',
        provider: doc.provider || 'groq',
        plain: decryptSecret(doc.encryptedKey),
      }
    } catch {
      throw new ApiError(
        500,
        'That saved key could not be decrypted (ENCRYPTION_SECRET changed?). Delete it and add the key again.',
        'KEY_DECRYPT_FAILED',
      )
    }
  })
}

export async function resolveKeyForUser(ownerId, keyId = null) {
  const [first] = await resolveKeysForUser(ownerId, keyId)
  return first
}

export function agentConfig() {
  return { providers: DEFAULT_PROVIDER_ORDER, provider: getProvider('groq') }
}
