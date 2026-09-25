import { Router } from 'express'
import { getShells } from '../controllers/terminal.controller.js'

const router = Router()

router.get('/shells', getShells)

export default router
