/**
 * Express 4 does not forward rejected promises to the error middleware, so every
 * async controller is wrapped in this helper.
 */
export default function asyncHandler(handler) {
  return function wrapped(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next)
  }
}
