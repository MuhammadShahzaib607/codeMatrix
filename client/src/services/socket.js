import { io } from 'socket.io-client'
import { API_BASE_URL } from './api'

/**
 * One socket connection is created lazily and shared by every terminal tab.
 * Reconnecting per terminal would spawn duplicate sessions and waste sockets.
 */
export const SOCKET_URL = (
  import.meta.env.VITE_SOCKET_URL ?? import.meta.env.VITE_API_URL ?? API_BASE_URL
).replace(/\/+$/, '')

let socket = null

export function getSocket() {
  if (!socket) {
    socket = io(SOCKET_URL, {
      transports: ['websocket'],
      autoConnect: true,
      reconnection: true,
    })
  }
  return socket
}

export function disconnectSocket() {
  if (!socket) return
  socket.disconnect()
  socket = null
}
