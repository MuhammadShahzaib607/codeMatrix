import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

const here = path.dirname(fileURLToPath(import.meta.url))

// Always read server/.env, regardless of the process working directory.
dotenv.config({ path: path.resolve(here, '..', '..', '.env') })

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 4000,
  mongoUri: process.env.MONGODB_URI || '',
  clientOrigin: process.env.CLIENT_ORIGIN || '*',
  // Signing key for auth JWTs. The fallback keeps local dev working, but any
  // real deployment MUST set JWT_SECRET (see .env.example).
  jwtSecret: process.env.JWT_SECRET || 'dev-insecure-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  workspacesRoot: process.env.WORKSPACES_ROOT || '',
}

/**
 * Turns the CLIENT_ORIGIN setting into something `cors` accepts. '*' (the
 * default) allows any origin, which is what we want while the client is served
 * from a different host than the API.
 */
export function resolveCorsOrigin() {
  if (env.clientOrigin.trim() === '*') return true
  return env.clientOrigin
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
}
