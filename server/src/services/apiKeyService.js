import mongoose from 'mongoose'
import { isDatabaseConnected } from '../config/db.js'
import { env } from '../config/env.js'
import { GroqApiKey } from '../models/GroqApiKey.model.js'
import User from '../models/User.model.js'
import ApiError from '../utils/ApiError.js'
import { decryptSecret, encryptSecret, maskSecret } from '../utils/keyVault.js'

/** Hard cap per user (enforced here so every entry point shares the rule). */
export const MAX_KEYS_PER_USER = 3

function requireDatabase() {
  if (!isDatabaseConnected()) {
    throw new ApiError(
      503,
      'API keys are unavailable because the server has no database configured.',
      'KEYS_UNAVAILABLE',
    )
  }
}

/** Masked, client-safe view. The plaintext key is never included, by design. */
function toPublic(doc) {
  let masked = '••••'
  try {
    masked = maskSecret(decryptSecret(doc.encryptedKey))
  } catch {
    // A key encrypted with an old/rotated secret still lists, just unreadable.
    masked = 'gsk_...????'
  }
  return {
    id: String(doc._id),
    label: doc.label || '',
    masked,
    createdAt: doc.createdAt ?? null,
  }
}

/** The user's saved keys, masked (never the full key). */
export async function listKeysForUser(ownerId) {
  requireDatabase()
  const docs = await GroqApiKey.find({ owner: ownerId }).sort({ createdAt: -1 }).lean()
  return docs.map(toPublic)
}

/**
 * Encrypts and stores a new key, enforcing the 3-key maximum.
 * Returns the masked, client-safe view of what was saved.
 */
export async function saveKeyForUser(ownerId, rawKey, label = '') {
  requireDatabase()
  const key = String(rawKey ?? '').trim()
  if (!key) {
    throw new ApiError(400, 'A Groq API key is required.', 'KEY_REQUIRED')
  }
  if (/\s/.test(key) || key.length < 12) {
    throw new ApiError(
      400,
      'That does not look like a valid Groq API key (expected something like gsk_…).',
      'KEY_INVALID',
    )
  }

  const existing = await GroqApiKey.countDocuments({ owner: ownerId })
  if (existing >= MAX_KEYS_PER_USER) {
    throw new ApiError(
      400,
      `Maximum ${MAX_KEYS_PER_USER} API keys allowed. Delete one before adding another.`,
      'KEY_LIMIT_REACHED',
    )
  }

  const doc = await GroqApiKey.create({
    owner: ownerId,
    label: String(label ?? '').trim().slice(0, 60),
    encryptedKey: encryptSecret(key),
    createdAt: new Date(),
  })
  return toPublic(doc)
}

/** Deletes one of the user's OWN keys. Returns false when nothing matched. */
export async function deleteKeyForUser(ownerId, keyId) {
  requireDatabase()
  const result = await GroqApiKey.deleteOne({ _id: keyId, owner: ownerId })
  return result.deletedCount > 0
}

/**
 * Re-checks the caller's ACCOUNT password (the CodeMatrix login password, not
 * the API key) against the stored bcrypt hash using the User model's own
 * comparePassword. Used to gate revealing and editing a saved key. Throws 401
 * with a clear message when it does not match, so no key data can leak.
 */
export async function verifyAccountPassword(userId, password) {
  requireDatabase()
  const candidate = typeof password === 'string' ? password : ''
  if (!candidate) {
    throw new ApiError(
      401,
      'Enter your account password to continue.',
      'PASSWORD_REQUIRED',
    )
  }
  const user = await User.findById(userId)
  if (!user) {
    throw new ApiError(404, 'That account no longer exists.', 'USER_NOT_FOUND')
  }
  const isValid = await user.comparePassword(candidate)
  if (!isValid) {
    throw new ApiError(
      401,
      'Incorrect password. Your API key was not revealed.',
      'INVALID_PASSWORD',
    )
  }
}

/**
 * FULL, decrypted key for its owner ONLY. Never exposed on a plain list call —
 * callers must verify the account password first (verifyAccountPassword).
 */
export async function revealKeyForUser(ownerId, keyId) {
  requireDatabase()
  if (!mongoose.isValidObjectId(keyId)) {
    throw new ApiError(404, 'API key not found.', 'KEY_NOT_FOUND')
  }
  const doc = await GroqApiKey.findOne({ _id: keyId, owner: ownerId })
  if (!doc) {
    throw new ApiError(404, 'API key not found.', 'KEY_NOT_FOUND')
  }
  try {
    return {
      id: String(doc._id),
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

/**
 * Updates the label and/or replaces the key value of one of the user's OWN
 * keys. Re-encrypts the new value before it is stored; ownership is enforced by
 * filtering every query on owner. Returns the masked, client-safe view.
 */
export async function updateKeyForUser(ownerId, keyId, { label, key } = {}) {
  requireDatabase()
  if (!mongoose.isValidObjectId(keyId)) {
    throw new ApiError(404, 'API key not found.', 'KEY_NOT_FOUND')
  }
  const doc = await GroqApiKey.findOne({ _id: keyId, owner: ownerId })
  if (!doc) {
    throw new ApiError(404, 'API key not found.', 'KEY_NOT_FOUND')
  }

  if (typeof label === 'string') {
    doc.label = label.trim().slice(0, 60)
  }

  if (typeof key === 'string' && key.trim()) {
    const raw = key.trim()
    if (/\s/.test(raw) || raw.length < 12) {
      throw new ApiError(
        400,
        'That does not look like a valid Groq API key (expected something like gsk_…).',
        'KEY_INVALID',
      )
    }
    doc.encryptedKey = encryptSecret(raw)
  }

  await doc.save()
  return toPublic(doc)
}

/**
 * ALL of the user's saved keys, decrypted in memory for ONE agent run, in the
 * order the fallback chain should try them: the caller-specified key first (when
 * given), then every other key newest-first. This is what lets the agent cycle
 * through the user's 2-3 keys when one is rate-limited instead of failing.
 *
 * The plaintext values are handed to agentService and dropped when the run ends.
 */
export async function resolveKeysForUser(ownerId, preferredKeyId = null) {
  requireDatabase()
  if (preferredKeyId && !mongoose.isValidObjectId(preferredKeyId)) {
    throw new ApiError(404, 'API key not found.', 'KEY_NOT_FOUND')
  }

  const docs = await GroqApiKey.find({ owner: ownerId }).sort({ createdAt: -1 }).lean()
  if (docs.length === 0) {
    throw new ApiError(
      404,
      'No Groq API key saved yet. Add one in Settings -> AI to use the assistant.',
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

  return ordered.map((doc) => {
    try {
      return {
        id: String(doc._id),
        label: doc.label || '',
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

/**
 * The ONE key to use for an agent run: the caller-specified one, or (default)
 * the most recently added. Kept for callers that only need a single key; the
 * agent's fallback chain uses resolveKeysForUser. Decrypts in memory JUST for
 * this call — the plaintext is dropped when the run ends.
 */
export async function resolveKeyForUser(ownerId, keyId = null) {
  const [first] = await resolveKeysForUser(ownerId, keyId)
  return first
}

/** True when the model/endpoints are configured (always true; kept for clarity). */
export function agentConfig() {
  return { model: env.groqModel, baseUrl: env.groqBaseUrl }
}
