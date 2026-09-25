import mongoose from 'mongoose'

/**
 * Metadata only. The actual project files are NEVER stored in MongoDB — they
 * live on the server's disk under `diskPath` and are wiped whenever the server
 * restarts on the free tier.
 *
 * ownerId is a plain string; full authentication does not exist yet.
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
    ownerId: {
      type: String,
      required: true,
      default: 'local-user',
      index: true,
      trim: true,
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
