import { Router } from 'express'
import * as apiKeyController from '../controllers/apiKey.controller.js'
import protect from '../middlewares/authMiddleware.js'

const router = Router()

// Every key route is part of the AI agent's settings surface, so all of them
// are admin-only. Ownership is still enforced in the service layer (every
// query is filtered by req.user.id).
router.use(protect)

router.get('/providers', apiKeyController.listProviders)
router.get('/', apiKeyController.listKeys)
// Latest captured rate-limit usage for every saved key (no fresh Groq call).
router.get('/usage', apiKeyController.listKeyUsage)
router.post('/', apiKeyController.createKey)
// Password-gated (body: { password }): the only routes that ever touch the
// decrypted key at rest.
router.post('/:id/reveal', apiKeyController.revealKey)
router.put('/:id', apiKeyController.updateKey)
router.delete('/:id', apiKeyController.removeKey)

export default router
