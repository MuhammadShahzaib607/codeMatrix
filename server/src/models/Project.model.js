import mongoose from 'mongoose'

/**
 * Metadata only. The actual project files are NEVER stored in MongoDB — they
 * live on the server's disk under `diskPath` and are wiped whenever the server
 * restarts on the free tier.
 *
 * `owner` is a real reference to a User, so every workspace operation can check
 * that the signed-in user owns the project before touching the disk.
 */
const projectSchema = new mongoose.Schema(
  {
    projectId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      default: 'Untitled Project',
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    diskPath: {
      type: String,
      required: true,
      trim: true,
    },
    lastAccessedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true },
)

export const Project = mongoose.model('Project', projectSchema)

export default Project
