import { useEffect } from 'react'
import { useDispatch } from 'react-redux'
import { agentAction, agentDone } from '../features/aiSlice'
import { getSocket } from '../services/socket'

/**
 * Bridges the agent's Socket.IO stream into Redux: every 'agent:action'
 * (create_file, run_command, thinking, …) lands in the AI panel's live feed as
 * it happens, and 'agent:done' closes the run with the model's final summary.
 * Mounted once in App, exactly like useWorkspaceWatcher.
 */
export default function useAgentEvents() {
  const dispatch = useDispatch()

  useEffect(() => {
    const socket = getSocket()

    function handleAction(event) {
      if (event) dispatch(agentAction(event))
    }

    function handleDone(payload) {
      dispatch(agentDone(payload ?? { ok: false, message: 'The agent stopped unexpectedly.' }))
    }

    socket.on('agent:action', handleAction)
    socket.on('agent:done', handleDone)
    return () => {
      socket.off('agent:action', handleAction)
      socket.off('agent:done', handleDone)
    }
  }, [dispatch])
}
