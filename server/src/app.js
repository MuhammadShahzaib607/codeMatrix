import cors from 'cors'
import express from 'express'
import { resolveCorsOrigin } from './config/env.js'
import errorHandler from './middlewares/errorHandler.js'
import notFound from './middlewares/notFound.js'
import apiRoutes from './routes/index.js'

const app = express()

app.disable('x-powered-by')

app.use(cors({ origin: resolveCorsOrigin() }))

// A large limit because the whole imported project is POSTed as one JSON body
// (capped at 5000 files by the import controller).
app.use(express.json({ limit: '50mb' }))

app.use('/api', apiRoutes)

app.use(notFound)
app.use(errorHandler)

export default app
