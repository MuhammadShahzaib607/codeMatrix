import ApiError from './ApiError.js'
import { findTerminalsCwdInside } from './terminalManager.js'

const IN_USE_CODES = new Set(['EBUSY', 'EPERM', 'EACCES', 'ENOTEMPTY'])

/**
 * Turns a raw filesystem failure from a delete into a short, readable API error
 * that never contains an absolute server path or an errno name. The full
 * detail (code, message, path) goes to the server log.
 *
 * When the folder is busy because a shell's working directory sits inside it,
 * the message names that cause explicitly so the user knows what to do.
 */
export function deleteFailureError(error, absolutePath, displayName, options = {}) {
  const name = String(displayName ?? 'that folder')
  console.warn(
    `[delete] ${name}: ${error?.code ?? 'UNKNOWN'} ${error?.message ?? error}` +
      (absolutePath ? ` (${absolutePath})` : ''),
  )

  if (IN_USE_CODES.has(error?.code)) {
    const terminals = Array.isArray(options.terminals)
      ? options.terminals
      : findTerminalsCwdInside(absolutePath)
    if (terminals.length > 0) {
      return new ApiError(
        409,
        'A terminal is running inside this folder. Close it and try again.',
        'TERMINALS_IN_USE',
      )
    }
    return new ApiError(
      409,
      `Could not delete "${name}" right now — it is being used by another program. Close it and try again.`,
      'FOLDER_IN_USE',
    )
  }

  return new ApiError(409, `Could not delete "${name}".`, 'DELETE_FAILED')
}

/** Runs a deletion and maps any filesystem failure to a clean user-facing error. */
export async function runDeletion(deleteIt, absolutePath, displayName, options = {}) {
  try {
    return await deleteIt()
  } catch (error) {
    throw deleteFailureError(error, absolutePath, displayName, options)
  }
}

export function transferFailureError(error, absolutePath, displayName) {
  const name = String(displayName ?? 'that item')
  console.warn(
    `[transfer] ${name}: ${error?.code ?? 'UNKNOWN'} ${error?.message ?? error}` +
      (absolutePath ? ` (${absolutePath})` : ''),
  )

  if (IN_USE_CODES.has(error?.code)) {
    const terminals = findTerminalsCwdInside(absolutePath)
    if (terminals.length > 0) {
      return new ApiError(
        409,
        'A terminal is running inside this folder. Close it or run cd .. and try again.',
        'FOLDER_IN_USE',
      )
    }
    return new ApiError(
      409,
      `Could not move "${name}" right now — it is being used by another program. Close it and try again.`,
      'FOLDER_IN_USE',
    )
  }

  return new ApiError(409, `Could not move "${name}".`, 'MOVE_FAILED')
}
