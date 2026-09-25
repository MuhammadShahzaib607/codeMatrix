import { env } from '../config/env.js'

export default function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error)

  const statusCode = error.statusCode || 500
  const payload = {
    error: {
      message: statusCode >= 500 ? 'Internal server error.' : error.message,
    },
  }
  if (error.code) payload.error.code = error.code

  if (statusCode >= 500) {
    console.error(`[error] ${req.method} ${req.originalUrl}`, error)
    if (env.nodeEnv !== 'production' && error.message) {
      payload.error.message = error.message
    }
  }

  return res.status(statusCode).json(payload)
}
