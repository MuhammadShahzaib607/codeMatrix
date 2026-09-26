import { Router } from 'express'
import * as apiKeyController from '../controllers/apiKey.controller.js'
import protect from '../middlewares/authMiddleware.js'

const router = Router()

// Everything here is per-user and JWT-protected; ownership is enforced in the
// service layer (every query is filtered by req.user.id).
router.use(protect)
router.get('/', apiKeyController.listKeys)
router.post('/', apiKeyController.createKey)
// Password-gated (body: { password }): the only routes that ever touch the
// decrypted key at rest.
router.post('/:id/reveal', apiKeyController.revealKey)
router.put('/:id', apiKeyController.updateKey)
router.delete('/:id', apiKeyController.removeKey)

export default router
