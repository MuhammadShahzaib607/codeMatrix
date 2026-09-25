import { Router } from 'express'
import healthRoutes from './health.routes.js'
import workspaceRoutes from './workspace.routes.js'

const router = Router()

router.use('/health', healthRoutes)
router.use('/workspace', workspaceRoutes)

export default router
