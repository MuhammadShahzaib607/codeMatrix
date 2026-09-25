import { Router } from 'express'
import * as workspaceController from '../controllers/workspace.controller.js'
import ensureWorkspace from '../middlewares/ensureWorkspace.js'
import validateProjectId from '../middlewares/validateProjectId.js'

const router = Router()

// Every route below needs a safe projectId. `import` is the only one allowed to
// run when the workspace folder does not exist yet, so it skips ensureWorkspace.
router.use('/:projectId', validateProjectId)

router.post('/:projectId/import', workspaceController.importProject)

router.get('/:projectId/tree', ensureWorkspace, workspaceController.getTree)
router.get('/:projectId/file', ensureWorkspace, workspaceController.getFile)
router.put('/:projectId/file', ensureWorkspace, workspaceController.saveFile)
router.post('/:projectId/create', ensureWorkspace, workspaceController.createEntry)
router.delete('/:projectId/delete', ensureWorkspace, workspaceController.deleteEntry)
router.patch('/:projectId/rename', ensureWorkspace, workspaceController.renameEntry)
router.get('/:projectId/export', ensureWorkspace, workspaceController.exportWorkspace)

export default router
