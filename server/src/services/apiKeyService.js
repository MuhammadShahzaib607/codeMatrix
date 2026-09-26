import mongoose from 'mongoose'
import { isDatabaseConnected } from '../config/db.js'
import { env } from '../config/env.js'
import { GroqApiKey } from '../models/GroqApiKey.model.js'
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
 * The key to use for an agent run: the caller-specified one, or (default) the
 * most recently added. Decrypts in memory JUST for this call — the plaintext is
 * handed to agentService and dropped when the run ends.
 */
export async function resolveKeyForUser(ownerId, keyId = null) {
  requireDatabase()
  if (keyId && !mongoose.isValidObjectId(keyId)) {
    throw new ApiError(404, 'API key not found.', 'KEY_NOT_FOUND')
  }
  const filter = keyId ? { owner: ownerId, _id: keyId } : { owner: ownerId }
  const doc = await GroqApiKey.findOne(filter).sort({ createdAt: -1 }).lean()
  if (!doc) {
    if (!keyId) {
      throw new ApiError(
        404,
        'No Groq API key saved yet. Add one in Settings -> AI to use the assistant.',
        'NO_KEYS',
      )
    }
    throw new ApiError(404, 'API key not found.', 'KEY_NOT_FOUND')
  }
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
}

/** True when the model/endpoints are configured (always true; kept for clarity). */
export function agentConfig() {
  return { model: env.groqModel, baseUrl: env.groqBaseUrl }
}
