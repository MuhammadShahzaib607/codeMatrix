/**
 * An error that is safe to send to the client. Anything that is not an
 * ApiError is treated as an unexpected 500 by the error handler.
 *
 * `code` is a machine-readable string (e.g. WORKSPACE_MISSING) that the client
 * uses to special-case a few failures, notably an ephemeral disk reset.
 */
export default class ApiError extends Error {
  constructor(statusCode, message, code) {
    super(message)
    this.name = 'ApiError'
    this.statusCode = statusCode
    this.code = code
    this.isOperational = true
  }
}
