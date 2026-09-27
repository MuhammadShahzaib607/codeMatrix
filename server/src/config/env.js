import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

const here = path.dirname(fileURLToPath(import.meta.url))

dotenv.config({ path: path.resolve(here, '..', '..', '.env') })

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 4000,
  mongoUri: process.env.MONGODB_URI || '',
  clientOrigin: process.env.CLIENT_ORIGIN || '*',
  jwtSecret: process.env.JWT_SECRET || 'dev-insecure-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  workspacesRoot: process.env.WORKSPACES_ROOT || '',
  // AES-256-GCM secret for USER-PROVIDED Groq API keys (see utils/keyVault.js).
  // Server-side only — never sent to the client. When unset, keyVault falls
  // back to a value derived from jwtSecret and warns in development.
  encryptionSecret: process.env.ENCRYPTION_SECRET || '',
  // OPTIONAL preferred Groq model. The agent NO LONGER relies on a hardcoded
  // id (Groq retires models — the old `llama-3.3-70b-versatile` default started
  // 404ing): at the start of each run it lists the models the user's key can use
  // and picks the first tool-capable one. When GROQ_MODEL is set here, that id
  // is tried first and the dynamic list is the fallback. There is NO built-in
  // Groq API key anywhere in this app: every request uses a key the user saved.
  groqModel: (process.env.GROQ_MODEL || '').trim(),
  // Overridable so tests can point the agent at a local stand-in for Groq.
  // Leading/trailing whitespace is stripped so a stray space in .env can never
  // corrupt the request URL.
  groqBaseUrl: (process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1')
    .trim()
    .replace(/\/+$/, ''),
}

export function resolveCorsOrigin() {
  if (env.clientOrigin.trim() === '*') return true
  return env.clientOrigin
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
    // Browser `Origin` headers never carry a trailing slash
    // (http://localhost:5173, not http://localhost:5173/). The `cors` package
    // compares origins as exact strings, so a stray slash in CLIENT_ORIGIN
    // would silently drop Access-Control-Allow-Origin and block every request.
    .map((origin) => origin.replace(/\/+$/, ''))
}
