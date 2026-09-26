import crypto from 'node:crypto'
import { env } from '../config/env.js'

// ---------------------------------------------------------------------------
// At-rest encryption for USER-PROVIDED Groq API keys.
//
// The app has zero built-in Groq keys; users save their own through
// /api/keys. Before a key touches MongoDB it is encrypted with AES-256-GCM
// under a server-side secret (ENCRYPTION_SECRET in server/.env) that never
// leaves the server. The plaintext exists only in memory, for the length of a
// single agent run, and is NEVER returned by any API response — the client
// only ever sees the masked form ("gsk_...a1b2").
// ---------------------------------------------------------------------------

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const VERSION = 'v1'
const KEY_SALT = 'code-matrix:groq-key-vault:v1'

let cachedKey = null
let warned = false

/** scrypt-derived 32-byte key so even a short passphrase becomes AES-256. */
function derivedKey() {
  if (cachedKey) return cachedKey
  const secret = env.encryptionSecret
  if (!secret && !warned) {
    warned = true
    console.warn(
      '[keys] ENCRYPTION_SECRET is not set — falling back to a secret derived from JWT_SECRET. ' +
        'Set ENCRYPTION_SECRET in server/.env before storing real API keys.',
    )
  }
  const material = secret || `jwt-fallback:${env.jwtSecret}`
  cachedKey = crypto.scryptSync(material, KEY_SALT, 32)
  return cachedKey
}

/** Encrypts a plaintext secret -> "v1.<iv>.<authTag>.<ciphertext>" (base64 parts). */
export function encryptSecret(plainText) {
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, derivedKey(), iv)
  const encrypted = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [
    VERSION,
    iv.toString('base64'),
    tag.toString('base64'),
    encrypted.toString('base64'),
  ].join('.')
}

/** Reverses encryptSecret. Throws if the payload was tampered with or the secret changed. */
export function decryptSecret(packed) {
  const [version, ivB64, tagB64, dataB64] = String(packed).split('.')
  if (version !== VERSION || !ivB64 || !tagB64 || !dataB64) {
    throw new Error('Unrecognised encrypted key format.')
  }
  const decipher = crypto.createDecipheriv(ALGORITHM, derivedKey(), Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8')
}

/**
 * The ONLY form of a key that may reach the client: first 4 + "..." + last 4
 * ("gsk_...a1b2"). Short values are masked down to their first 3 characters.
 */
export function maskSecret(plainText) {
  const key = String(plainText ?? '')
  if (key.length <= 12) return `${key.slice(0, 3)}...`
  return `${key.slice(0, 4)}...${key.slice(-4)}`
}
