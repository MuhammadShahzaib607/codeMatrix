import { Router } from 'express'
import * as previewController from '../controllers/preview.controller.js'
import authorizeProject from '../middlewares/authorizeProject.js'
import protectPreview from '../middlewares/protectPreview.js'
import validatePreviewSegment from '../middlewares/validatePreviewSegment.js'

/**
 * The public-facing live preview. Mounted at /preview (NOT under /api) so the
 * URL a user opens in a browser tab is a clean static path:
 *
 *   /preview/:projectId/index.html?token=<jwt>
 *   /preview/:projectId/styles/style.css?token=<jwt>
 *
 * `protectPreview` verifies the JWT from the query string (or the Authorization
 * header), then the same ownership + workspace checks the workspace API uses.
 */
const router = Router()

// ensureWorkspace is intentionally NOT part of this chain: the first segment
// may be a project id OR the name of a sibling top-level folder, and only the
// controller knows which. It resolves the path with the same traversal guards
// and answers 404 itself.
const guards = [protectPreview, validatePreviewSegment, authorizeProject]

// Bare project root -> index.html.
router.get('/:projectId', ...guards, previewController.servePreviewFile)
// Every other path in the workspace (req.params[0] is the remainder).
router.get('/:projectId/*', ...guards, previewController.servePreviewFile)

export default router
