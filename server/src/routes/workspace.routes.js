import { Router } from 'express'
import * as workspaceController from '../controllers/workspace.controller.js'
import protect from '../middlewares/authMiddleware.js'
import authorizeProject from '../middlewares/authorizeProject.js'
import ensureWorkspace from '../middlewares/ensureWorkspace.js'
import validateProjectId from '../middlewares/validateProjectId.js'
import { receiveUpload, uploadContainerFiles } from '../controllers/upload.controller.js'

const router = Router()

router.use(protect)

// The user's single reusable scratch workspace. Must be registered BEFORE the
// '/:projectId' guard below so 'scratch' is not treated as a project id.
router.post('/scratch', workspaceController.openScratchWorkspaceHandler)

// The Explorer's top level: the per-user container of projects. Registered
// before the '/:projectId' guard so 'container' is not read as a project id.
router.get('/container', workspaceController.listContainer)
router.post('/container/entry', workspaceController.createContainerEntry)
router.post('/container/paste', workspaceController.pasteToContainer)

// The whole container as ONE tree, plus its file operations. A path whose first
// segment names a project folder is delegated to that project server-side, so
// the client can treat the entire container as a single workspace.
router.get('/container/tree', workspaceController.getContainerTreeHandler)
router.get('/container/file', workspaceController.readContainerFile)
router.get('/container/file/raw', workspaceController.readContainerFileRaw)
router.put('/container/file', workspaceController.saveContainerFile)
router.post('/container/create', workspaceController.createContainerEntryAt)
router.delete('/container/delete', workspaceController.deleteContainerEntryAt)
router.patch('/container/rename', workspaceController.renameContainerEntryAt)
router.post('/container/duplicate', workspaceController.duplicateContainerEntryAt)
router.post('/container/upload', receiveUpload, uploadContainerFiles)

router.use('/:projectId', validateProjectId, authorizeProject)

router.post('/:projectId/import', workspaceController.importProject)

router.get('/:projectId/tree', ensureWorkspace, workspaceController.getTree)
router.get('/:projectId/file', ensureWorkspace, workspaceController.getFile)
router.get('/:projectId/file/raw', ensureWorkspace, workspaceController.getFileRaw)
router.put('/:projectId/file', ensureWorkspace, workspaceController.saveFile)
router.post('/:projectId/create', ensureWorkspace, workspaceController.createEntry)
router.delete('/:projectId/delete', ensureWorkspace, workspaceController.deleteEntry)
router.patch('/:projectId/rename', ensureWorkspace, workspaceController.renameEntry)
router.post('/:projectId/duplicate', ensureWorkspace, workspaceController.duplicateEntry)
router.get('/:projectId/export', ensureWorkspace, workspaceController.exportWorkspace)

export default router
