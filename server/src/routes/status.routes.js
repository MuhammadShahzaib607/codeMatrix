import { Router } from 'express'
import { getHealthCheck, getHealthPlain, getRootStatus } from '../controllers/health.controller.js'

const router = Router()

router.get('/', getRootStatus)
router.get('/health', getHealthPlain)
router.get('/health-check', getHealthCheck)

export default router
