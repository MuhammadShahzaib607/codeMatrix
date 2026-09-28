import ApiError from '../utils/ApiError.js'
import asyncHandler from '../utils/asyncHandler.js'
import {
  MAX_KEYS_PER_PROVIDER,
  deleteKeyForUser,
  listKeysForUser,
  revealKeyForUser,
  saveKeyForUser,
  updateKeyForUser,
  verifyAccountPassword,
} from '../services/apiKeyService.js'
import { getKeyHealth, getUsageForKey, hydrateUsage } from '../services/usageService.js'
import { providerPublicConfig } from '../config/providers.js'

/**
 * GET /api/keys -> the user's saved keys, MASKED only ("gsk_...a1b2").
 * The full key never leaves the server: it is decrypted solely inside an agent
 * run (see services/agentService.js).
 */
export const listKeys = asyncHandler(async (req, res) => {
  const keys = await listKeysForUser(req.user.id)
  res.json({ keys, max: MAX_KEYS_PER_PROVIDER, providers: providerPublicConfig() })
})

/** GET /api/keys/providers -> public provider metadata (no secrets). */
export const listProviders = asyncHandler(async (req, res) => {
  res.json({ providers: providerPublicConfig() })
})

export const listKeyUsage = asyncHandler(async (req, res) => {
  const keys = await listKeysForUser(req.user.id)
  await hydrateUsage(keys)

  res.json({
    keys: keys.map((key) => {
      const { models, summary, preferredModel, lastUpdated } = getUsageForKey(key)
      return {
        id: key.id,
        provider: key.provider,
        providerLabel: key.providerLabel,
        label: key.label,
        masked: key.masked,
        status: getKeyHealth(key.id),
        model: preferredModel,
        models,
        summary,
        lastUpdated,
      }
    }),
    capturedAt: new Date().toISOString(),
  })
})

/** POST /api/keys { provider, key, label } -> validates, encrypts and saves. */
export const createKey = asyncHandler(async (req, res) => {
  const { provider, key, label } = req.body ?? {}
  const saved = await saveKeyForUser(req.user.id, { provider, key, label })
  res.status(201).json({ key: saved })
})

/** DELETE /api/keys/:id -> removes one of the user's OWN keys (ownership checked). */
export const removeKey = asyncHandler(async (req, res) => {
  const deleted = await deleteKeyForUser(req.user.id, req.params.id)
  if (!deleted) throw new ApiError(404, 'API key not found.', 'KEY_NOT_FOUND')
  res.json({ deleted: true, id: req.params.id })
})

/**
 * POST /api/keys/:id/reveal { password } -> the FULL key, but only after the
 * caller re-confirms their ACCOUNT password. A wrong password is a 401 and no
 * key data is included in the response.
 */
export const revealKey = asyncHandler(async (req, res) => {
  const { password } = req.body ?? {}
  await verifyAccountPassword(req.user.id, password)
  const revealed = await revealKeyForUser(req.user.id, req.params.id)
  res.json({ key: revealed })
})

/**
 * PUT /api/keys/:id { password, label?, key? } -> updates the label and/or
 * replaces the key value (re-encrypted). Also gated on the account password so
 * temporary access to an unlocked session cannot tamper with keys. Ownership is
 * enforced in the service layer.
 */
export const updateKey = asyncHandler(async (req, res) => {
  const { password, label, key } = req.body ?? {}
  await verifyAccountPassword(req.user.id, password)
  const updated = await updateKeyForUser(req.user.id, req.params.id, { label, key })
  res.json({ key: updated })
})
