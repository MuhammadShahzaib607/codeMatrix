import mongoose from 'mongoose'
import { env } from './env.js'

let connected = false

export async function connectDatabase() {
  if (!env.mongoUri) {
    console.warn('[db] MONGODB_URI is not set — project metadata will not be persisted.')
    return false
  }

  try {
    await mongoose.connect(env.mongoUri, { serverSelectionTimeoutMS: 8000 })
    connected = true
    console.log('[db] connected to MongoDB')
    return true
  } catch (error) {
    connected = false
    console.error(`[db] MongoDB connection failed: ${error.message}`)
    return false
  }
}

export function isDatabaseConnected() {
  return connected && mongoose.connection.readyState === 1
}

export async function disconnectDatabase() {
  if (mongoose.connection.readyState === 0) return
  await mongoose.disconnect()
  connected = false
}
