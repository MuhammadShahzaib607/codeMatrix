import mongoose from 'mongoose'
import { DEFAULT_PROVIDER_ORDER } from '../config/providers.js'

const PROVIDER_IDS = [...DEFAULT_PROVIDER_ORDER]

const apiKeySchema = new mongoose.Schema({
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  provider: {
    type: String,
    enum: PROVIDER_IDS,
    default: 'groq',
    index: true,
  },
  label: {
    type: String,
    trim: true,
    maxlength: 60,
    default: '',
  },
  encryptedKey: {
    type: String,
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
})

apiKeySchema.index({ owner: 1, provider: 1 })

export const ApiKey = mongoose.model('ApiKey', apiKeySchema)

export async function migrateLegacyGroqKeys() {
  const db = mongoose.connection?.db
  if (!db) return { migrated: 0, normalised: 0 }
  let migrated = 0

  try {
    const legacy = await db.collection('groqapikeys').find({}).toArray()
    for (const doc of legacy) {
      const exists = await db
        .collection('apikeys')
        .findOne({ _id: doc._id }, { projection: { _id: 1 } })
      if (exists) continue
      await db.collection('apikeys').insertOne({ ...doc, provider: doc.provider ?? 'groq' })
      migrated += 1
    }
  } catch {}

  let normalised = 0
  try {
    const result = await db
      .collection('apikeys')
      .updateMany(
        { provider: { $nin: PROVIDER_IDS } },
        { $set: { provider: 'groq' } },
      )
    normalised = result.modifiedCount ?? 0
  } catch {}

  return { migrated, normalised }
}

export default ApiKey
