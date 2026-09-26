import ApiError from '../utils/ApiError.js'
import asyncHandler from '../utils/asyncHandler.js'
import {
  MAX_KEYS_PER_USER,
  deleteKeyForUser,
  listKeysForUser,
  saveKeyForUser,
} from '../services/apiKeyService.js'

/**
 * GET /api/keys -> the user's saved keys, MASKED only ("gsk_...a1b2").
 * The full key never leaves the server: it is decrypted solely inside an agent
 * run (see services/agentService.js).
 */
export const listKeys = asyncHandler(async (req, res) => {
  const keys = await listKeysForUser(req.user.id)
  res.json({ keys, max: MAX_KEYS_PER_USER })
})

/** POST /api/keys { key, label } -> encrypts + saves (max 3 per user). */
export const createKey = asyncHandler(async (req, res) => {
  const { key, label } = req.body ?? {}
  const saved = await saveKeyForUser(req.user.id, key, label)
  res.status(201).json({ key: saved })
})

/** DELETE /api/keys/:id -> removes one of the user's OWN keys (ownership checked). */
export const removeKey = asyncHandler(async (req, res) => {
  const deleted = await deleteKeyForUser(req.user.id, req.params.id)
  if (!deleted) throw new ApiError(404, 'API key not found.', 'KEY_NOT_FOUND')
  res.json({ deleted: true, id: req.params.id })
})
