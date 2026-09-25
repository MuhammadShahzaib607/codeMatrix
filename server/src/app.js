import dns from 'node:dns'
import cors from 'cors'
import express from 'express'
import { resolveCorsOrigin } from './config/env.js'
import errorHandler from './middlewares/errorHandler.js'
import notFound from './middlewares/notFound.js'
import apiRoutes from './routes/index.js'

if (process.env.NODE_ENV !== 'production') {
  dns.setServers(['8.8.8.8', '1.1.1.1'])
}

const app = express();

app.disable('x-powered-by');

app.use(cors({ origin: resolveCorsOrigin() }))

app.use(express.json({ limit: '50mb' }))

app.use('/api', apiRoutes)

app.use(notFound);
app.use(errorHandler);

export default app