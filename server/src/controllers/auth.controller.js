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

function publicUser(user) {
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    role: user.role === 'admin' ? 'admin' : 'user',
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

  const user = await User.create({ name, email, password })

  res.status(201).json({ token: signToken(user._id), user: publicUser(user) })
})

export const login = asyncHandler(async (req, res) => {
  assertDatabase()

  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : ''
  const password = typeof req.body?.password === 'string' ? req.body.password : ''

  if (!email || !password) {
    throw new ApiError(400, 'Email and password are required.', 'MISSING_CREDENTIALS')
  }

  const user = await User.findOne({ email })
  const isValid = user ? await user.comparePassword(password) : false
  if (!isValid) {
    throw new ApiError(401, 'Invalid email or password.', 'INVALID_CREDENTIALS')
  }

  res.json({ token: signToken(user._id), user: publicUser(user) })
})

export const me = asyncHandler(async (req, res) => {
  assertDatabase()

  const user = await User.findById(req.user.id)
  if (!user) {
    throw new ApiError(404, 'That account no longer exists.', 'USER_NOT_FOUND')
  }

  res.json({ user: publicUser(user) })
})
