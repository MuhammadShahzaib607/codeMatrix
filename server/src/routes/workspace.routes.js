import { Router } from 'express'
import * as workspaceController from '../controllers/workspace.controller.js'
import protect from '../middlewares/authMiddleware.js'
import authorizeProject from '../middlewares/authorizeProject.js'
import ensureWorkspace from '../middlewares/ensureWorkspace.js'
import validateProjectId from '../middlewares/validateProjectId.js'

const router = Router()

// Every workspace route requires a signed-in user. The projectId is validated
// next (it becomes a directory name), then ownership is checked, then the disk
// folder is confirmed to still exist. `import` is the only route allowed to run
// before the folder exists, so it skips ensureWorkspace.
router.use(protect)
router.use('/:projectId', validateProjectId, authorizeProject)

router.post('/:projectId/import', workspaceController.importProject)

router.get('/:projectId/tree', ensureWorkspace, workspaceController.getTree)
router.get('/:projectId/file', ensureWorkspace, workspaceController.getFile)
router.put('/:projectId/file', ensureWorkspace, workspaceController.saveFile)
router.post('/:projectId/create', ensureWorkspace, workspaceController.createEntry)
router.delete('/:projectId/delete', ensureWorkspace, workspaceController.deleteEntry)
router.patch('/:projectId/rename', ensureWorkspace, workspaceController.renameEntry)
router.get('/:projectId/export', ensureWorkspace, workspaceController.exportWorkspace)

export default router
