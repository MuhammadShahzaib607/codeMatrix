import { Router } from 'express'
import { getHealthCheck, getRootStatus } from '../controllers/health.controller.js'

const router = Router()

router.get('/', getRootStatus)
router.get('/health-check', getHealthCheck)

export default router
