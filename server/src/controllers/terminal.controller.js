import { getShellOptions } from '../utils/terminalManager.js'

/**
 * GET /api/terminal/shells
 *
 * Lists the shells this SERVER can spawn, based on process.platform, so the
 * client can show an accurate dropdown (Windows dev: PowerShell/CMD/bash;
 * Linux deploy: bash only).
 */
export function getShells(req, res) {
  res.json(getShellOptions())
}
