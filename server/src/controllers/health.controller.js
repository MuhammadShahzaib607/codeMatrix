import { isDatabaseConnected } from '../config/db.js'
import { getShellOptions, isTerminalAvailable } from '../utils/terminalManager.js'

function databaseState() {
  return isDatabaseConnected() ? 'connected' : 'not-configured'
}

export function getHealth(req, res) {
  res.json({
    status: 'ok',
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    database: databaseState(),
    terminal: isTerminalAvailable() ? 'available' : 'unavailable',
  })
}

export function getRootStatus(req, res) {
  res.json({
    status: 'ok',
    message: 'CodeMatrix API is running',
    timestamp: new Date().toISOString(),
  })
}

export function getHealthPlain(req, res) {
  res.status(200).type('text/plain').send('ok')
}

export function getHealthCheck(req, res) {
  const shell = getShellOptions()
  res.json({
    status: 'ok',
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    database: databaseState(),
    terminal: {
      available: isTerminalAvailable(),
      platform: shell.platform,
      defaultShell: shell.default,
      shells: shell.shells,
    },
  })
}
