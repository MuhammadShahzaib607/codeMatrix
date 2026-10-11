import { io } from 'socket.io-client'
import { API_BASE_URL } from './api'

// The Socket.IO server shares the API server's origin, so it uses the same
// single source of truth (VITE_API_BASE_URL via services/api.js).
export const SOCKET_URL = API_BASE_URL

let socket = null

export function getSocket() {
  if (!socket) {
    socket = io(SOCKET_URL, {
      transports: ['websocket'],
      autoConnect: true,
      reconnection: true,
    })
    if (typeof window !== 'undefined') window.__SOCKET__ = socket
  }
  return socket
}

export function disconnectSocket() {
  if (!socket) return
  socket.disconnect()
  socket = null
}
