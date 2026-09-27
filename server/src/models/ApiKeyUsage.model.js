import mongoose from 'mongoose'

/**
 * The durable mirror of the latest Groq rate-limit numbers we captured for one
 * saved API key (see services/usageService.js). One document per keyId; the
 * in-memory cache is authoritative while the server is running and this exists
 * only so the numbers survive a restart. Never stores the key itself.
 */
const apiKeyUsageSchema = new mongoose.Schema(
  {
    keyId: { type: String, required: true, unique: true, index: true },
    userId: { type: String, default: null, index: true },
    label: { type: String, default: '' },
    remainingRequests: { type: Number, default: null },
    limitRequests: { type: Number, default: null },
    remainingTokens: { type: Number, default: null },
    limitTokens: { type: Number, default: null },
    resetRequestsAt: { type: String, default: null },
    resetTokensAt: { type: String, default: null },
    updatedAt: { type: String, default: null },
  },
  { minimize: false },
)

const ApiKeyUsage = mongoose.model('ApiKeyUsage', apiKeyUsageSchema)

export { ApiKeyUsage }
export default ApiKeyUsage
