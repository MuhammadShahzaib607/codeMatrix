import { Router } from 'express'
import * as projectController from '../controllers/project.controller.js'
import protect from '../middlewares/authMiddleware.js'

const router = Router()

router.use(protect)
router.post('/', projectController.createProjectHandler)
router.get('/', projectController.listProjectsHandler)
// Deletes a whole project: workspace folder (recursive) + MongoDB record.
router.delete('/:projectId', projectController.deleteProjectHandler)

export default router
