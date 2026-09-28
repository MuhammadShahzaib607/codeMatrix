import mongoose from 'mongoose'

const usageEventSchema = new mongoose.Schema({
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  keyId: { type: String, required: true, index: true },
  provider: { type: String, required: true },
  model: { type: String, required: true },
  taskId: { type: String, default: null, index: true },
  promptTokens: { type: Number, default: 0 },
  completionTokens: { type: Number, default: 0 },
  totalTokens: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now, expires: 3456000 },
})

usageEventSchema.index({ keyId: 1, model: 1, createdAt: -1 })

export const UsageEvent = mongoose.model('UsageEvent', usageEventSchema)

export default UsageEvent
