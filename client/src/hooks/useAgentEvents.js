import { useEffect } from 'react'
import { useDispatch } from 'react-redux'
import { agentAction, agentDone, fetchKeyUsage, usageUpdated } from '../features/aiSlice'
import { applyAgentProject } from '../features/fileSystemSlice'
import { getSocket } from '../services/socket'
import { saveWorkspaceRef } from '../services/workspaceStorage'

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
      // A scratch workspace adopted as a real project mid-run. Update the
      // Explorer root label + topbar chip immediately and remember the name so
      // a reload restores the project under its new identity. The event still
      // lands in the feed as a normal action row.
      if (event?.type === 'project' && event.details?.projectId && event.details?.name) {
        dispatch(
          applyAgentProject({ projectId: event.details.projectId, name: event.details.name }),
        )
        saveWorkspaceRef({ projectId: event.details.projectId, name: event.details.name })
      }
      if (event) dispatch(agentAction(event))
    }

    // Live rate-limit snapshot captured from the most recent Groq response, sent
    // alongside the action feed so both usage bars update in real time.
    function handleUsage(record) {
      dispatch(usageUpdated(record))
    }

    function handleDone(payload) {
      dispatch(agentDone(payload ?? { ok: false, message: 'The agent stopped unexpectedly.' }))
      // Belt-and-braces: reconcile with the server's stored values once the run
      // ends, in case a final snapshot event was missed.
      dispatch(fetchKeyUsage())
    }

    socket.on('agent:action', handleAction)
    socket.on('agent:usage', handleUsage)
    socket.on('agent:done', handleDone)
    return () => {
      socket.off('agent:action', handleAction)
      socket.off('agent:usage', handleUsage)
      socket.off('agent:done', handleDone)
    }
  }, [dispatch])
}
