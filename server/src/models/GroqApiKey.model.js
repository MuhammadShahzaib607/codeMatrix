import mongoose from 'mongoose'

/**
 * A Groq API key the USER explicitly provided (Settings -> AI). The plaintext
 * never touches this document: `encryptedKey` is AES-256-GCM output produced by
 * utils/keyVault.js, and only apiKeyService ever decrypts it — in memory, for
 * the duration of one agent run. No route ever returns `encryptedKey`.
 */
const groqApiKeySchema = new mongoose.Schema({
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
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

export const GroqApiKey = mongoose.model('GroqApiKey', groqApiKeySchema)

export default GroqApiKey
