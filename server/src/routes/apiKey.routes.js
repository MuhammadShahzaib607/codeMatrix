import { Router } from 'express'
import * as apiKeyController from '../controllers/apiKey.controller.js'
import protect from '../middlewares/authMiddleware.js'

const router = Router()

// Everything here is per-user and JWT-protected; ownership is enforced in the
// service layer (every query is filtered by req.user.id).
router.use(protect)
router.get('/', apiKeyController.listKeys)
router.post('/', apiKeyController.createKey)
router.delete('/:id', apiKeyController.removeKey)

export default router
