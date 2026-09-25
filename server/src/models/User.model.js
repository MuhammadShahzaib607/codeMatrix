import bcrypt from 'bcryptjs'
import mongoose from 'mongoose'

/**
 * A user account. Passwords are hashed with bcrypt in a pre-save hook, so the
 * plaintext never reaches the database. `comparePassword` is the only supported
 * way to check a login attempt.
 */
const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    password: {
      type: String,
      required: true,
    },
  },
  { timestamps: true },
)

// Hash only when the password actually changed (create or explicit reset).
userSchema.pre('save', async function hashPassword() {
  if (!this.isModified('password')) return
  const salt = await bcrypt.genSalt(10)
  this.password = await bcrypt.hash(this.password, salt)
})

userSchema.methods.comparePassword = function comparePassword(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password)
}

export const User = mongoose.model('User', userSchema)

export default User
