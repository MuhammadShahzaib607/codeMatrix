import { isDatabaseConnected } from '../config/db.js'
import { isTerminalAvailable } from '../utils/terminalManager.js'

/**
 * GET /api/health
 *
 * Intended for a cron-job.org uptime ping once the deployment is upgraded.
 * It never touches the filesystem so it stays cheap on the free tier.
 */
export function getHealth(req, res) {
  res.json({
    status: 'ok',
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    database: isDatabaseConnected() ? 'connected' : 'not-configured',
    terminal: isTerminalAvailable() ? 'available' : 'unavailable',
  })
}
