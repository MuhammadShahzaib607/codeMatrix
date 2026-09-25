export default class ApiError extends Error {
  constructor(statusCode, message, code) {
    super(message)
    this.name = 'ApiError'
    this.statusCode = statusCode
    this.code = code
    this.isOperational = true
  }
}
