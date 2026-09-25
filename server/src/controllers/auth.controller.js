import jwt from 'jsonwebtoken'
import { isDatabaseConnected } from '../config/db.js'
import { env } from '../config/env.js'
import User from '../models/User.model.js'
import ApiError from '../utils/ApiError.js'
import asyncHandler from '../utils/asyncHandler.js'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MIN_PASSWORD_LENGTH = 6

function signToken(userId) {
  return jwt.sign({ id: userId }, env.jwtSecret, { expiresIn: env.jwtExpiresIn })
}

/** The only user shape that ever leaves the API — never includes the hash. */
function publicUser(user) {
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
  }
}

function assertDatabase() {
  if (!isDatabaseConnected()) {
    throw new ApiError(
      503,
      'Authentication is unavailable because the server has no database configured.',
      'AUTH_UNAVAILABLE',
    )
  }
}

/* ------------------------------------------------------------------ *
 * POST /api/auth/register   { name, email, password }
 * ------------------------------------------------------------------ */

export const register = asyncHandler(async (req, res) => {
  assertDatabase()

  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : ''
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : ''
  const password = typeof req.body?.password === 'string' ? req.body.password : ''

  if (!name) throw new ApiError(400, 'Please enter your name.', 'INVALID_NAME')
  if (!EMAIL_PATTERN.test(email)) {
    throw new ApiError(400, 'Please enter a valid email address.', 'INVALID_EMAIL')
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new ApiError(
      400,
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
      'INVALID_PASSWORD',
    )
  }

  const existing = await User.findOne({ email })
  if (existing) {
    throw new ApiError(409, 'That email is already registered.', 'EMAIL_TAKEN')
  }

  // The pre-save hook hashes the password.
  const user = await User.create({ name, email, password })

  res.status(201).json({ token: signToken(user._id), user: publicUser(user) })
})

/* ------------------------------------------------------------------ *
 * POST /api/auth/login   { email, password }
 * ------------------------------------------------------------------ */

export const login = asyncHandler(async (req, res) => {
  assertDatabase()

  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : ''
  const password = typeof req.body?.password === 'string' ? req.body.password : ''

  if (!email || !password) {
    throw new ApiError(400, 'Email and password are required.', 'MISSING_CREDENTIALS')
  }

  const user = await User.findOne({ email })
  // Same message for "no such user" and "wrong password" so the endpoint cannot
  // be used to enumerate registered emails.
  const isValid = user ? await user.comparePassword(password) : false
  if (!isValid) {
    throw new ApiError(401, 'Invalid email or password.', 'INVALID_CREDENTIALS')
  }

  res.json({ token: signToken(user._id), user: publicUser(user) })
})

/* ------------------------------------------------------------------ *
 * GET /api/auth/me   (protected)
 * ------------------------------------------------------------------ */

export const me = asyncHandler(async (req, res) => {
  assertDatabase()

  const user = await User.findById(req.user.id)
  if (!user) {
    throw new ApiError(404, 'That account no longer exists.', 'USER_NOT_FOUND')
  }

  res.json({ user: publicUser(user) })
})
