import dns from 'node:dns'
import cors from 'cors'
import express from 'express'
import { resolveCorsOrigin } from './config/env.js'
import errorHandler from './middlewares/errorHandler.js'
import notFound from './middlewares/notFound.js'
import apiRoutes from './routes/index.js'
import previewRoutes from './routes/preview.routes.js'

if (process.env.NODE_ENV !== 'production') {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
}

const app = express();

app.disable('x-powered-by');

app.use(cors({ origin: resolveCorsOrigin() }))

app.use(express.json({ limit: '50mb' }))

app.use('/api', apiRoutes)

// Live preview static file server (JWT via ?token=, see preview.routes.js).
app.use('/preview', previewRoutes)

app.use(notFound);
app.use(errorHandler);

export default app