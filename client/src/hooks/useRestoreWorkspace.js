import { useEffect } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { reopenWorkspace } from '../features/workspaceThunks'
import { getWorkspaceRef } from '../services/workspaceStorage'

/**
 * Reopens the cloud project remembered from the last session, but only for a
 * signed-in user (workspace routes now require auth). A 404 still means the
 * server's ephemeral disk was reset, so the recovery notice is shown.
 */
export default function useRestoreWorkspace() {
  const dispatch = useDispatch()
  const isAuthenticated = useSelector((state) => state.auth.isAuthenticated)

  useEffect(() => {
    if (!isAuthenticated) return
    const ref = getWorkspaceRef()
    if (!ref?.projectId) return
    dispatch(reopenWorkspace({ projectId: ref.projectId, name: ref.name }))
  }, [isAuthenticated, dispatch])
}
