import { Router } from 'express'
import authRoutes from './auth.routes.js'
import healthRoutes from './health.routes.js'
import projectRoutes from './project.routes.js'
import workspaceRoutes from './workspace.routes.js'

const router = Router()

router.use('/health', healthRoutes)
router.use('/auth', authRoutes)
router.use('/projects', projectRoutes)
router.use('/workspace', workspaceRoutes)

export default router
