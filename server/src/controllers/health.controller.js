import { isDatabaseConnected } from '../config/db.js'
import { isTerminalAvailable } from '../utils/terminalManager.js'

export function getHealth(req, res) {
  res.json({
    status: 'ok',
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    database: isDatabaseConnected() ? 'connected' : 'not-configured',
    terminal: isTerminalAvailable() ? 'available' : 'unavailable',
  })
}
