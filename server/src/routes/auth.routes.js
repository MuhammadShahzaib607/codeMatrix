import { Router } from 'express'
import * as authController from '../controllers/auth.controller.js'
import protect from '../middlewares/authMiddleware.js'

const router = Router()

router.post('/register', authController.register)
router.post('/login', authController.login)
router.get('/me', protect, authController.me)

export default router
