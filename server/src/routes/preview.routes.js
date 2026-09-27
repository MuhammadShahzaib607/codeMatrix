import { Router } from 'express'
import * as previewController from '../controllers/preview.controller.js'
import authorizeProject from '../middlewares/authorizeProject.js'
import ensureWorkspace from '../middlewares/ensureWorkspace.js'
import protectPreview from '../middlewares/protectPreview.js'
import validateProjectId from '../middlewares/validateProjectId.js'

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

const guards = [protectPreview, validateProjectId, authorizeProject, ensureWorkspace]

// Bare project root -> index.html.
router.get('/:projectId', ...guards, previewController.servePreviewFile)
// Every other path in the workspace (req.params[0] is the remainder).
router.get('/:projectId/*', ...guards, previewController.servePreviewFile)

export default router
