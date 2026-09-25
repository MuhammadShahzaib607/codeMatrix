import { useEffect } from 'react'
import { useDispatch } from 'react-redux'
import { reopenWorkspace } from '../features/workspaceThunks'
import { getWorkspaceRef } from '../services/workspaceStorage'

/**
 * On first mount, tries to reopen the cloud project remembered from the last
 * session. When the server's ephemeral disk has been reset, the request 404s and
 * the thunk flips the workspaceMissing flag, which shows the recovery notice.
 */
export default function useRestoreWorkspace() {
  const dispatch = useDispatch()

  useEffect(() => {
    const ref = getWorkspaceRef()
    if (!ref?.projectId) return
    dispatch(reopenWorkspace({ projectId: ref.projectId, name: ref.name }))
  }, [dispatch])
}
