import mongoose from 'mongoose'
import { env } from './env.js'

let connected = false

export async function connectDatabase() {
  if (!env.mongoUri) {
    console.warn(
      '[db] NOT connected: MONGODB_URI is not set in server/.env — auth and projects are unavailable.',
    )
    return false
  }

  try {
    await mongoose.connect(env.mongoUri, { serverSelectionTimeoutMS: 8000 })
    connected = true
    console.log('[db] connected to MongoDB')
    return true
  } catch (error) {
    connected = false
    console.error(`[db] NOT connected: ${error.message}`)
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
