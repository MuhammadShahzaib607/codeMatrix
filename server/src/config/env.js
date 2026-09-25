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
