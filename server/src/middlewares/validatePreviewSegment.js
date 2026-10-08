import ApiError from '../utils/ApiError.js'

const MAX_SEGMENT_LENGTH = 128

/**
 * The first segment of a preview URL is normally a project id, but a relative
 * reference to a SIBLING top-level folder arrives as that folder's NAME
 * ("../sibling/logo.png" -> /preview/sibling/logo.png), and folder names may
 * contain dots and spaces. Anything that could escape the segment position is
 * rejected here; the real traversal guard runs where the path is resolved.
 */
export default function validatePreviewSegment(req, res, next) {
  const segment = String(req.params?.projectId ?? '')
  const invalid =
    !segment ||
    segment.length > MAX_SEGMENT_LENGTH ||
    segment === '.' ||
    segment === '..' ||
    segment.includes('/') ||
    segment.includes('\\') ||
    segment.includes('\0')

  if (invalid) {
    return next(new ApiError(400, 'Invalid preview path.', 'INVALID_PATH'))
  }
  return next()
}
