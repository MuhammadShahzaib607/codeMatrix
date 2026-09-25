import mongoose from 'mongoose'

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
    // The project folder's real name on disk (e.g. "shahzaib-art-4f2a"), which
    // is derived from the display name so users can `cd` into it. Kept separate
    // from `name` (the human-readable label) and from projectId.
    diskFolderName: {
      type: String,
      trim: true,
      default: '',
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
