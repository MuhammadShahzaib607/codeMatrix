import { useEffect } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { reopenWorkspace } from '../features/workspaceThunks'
import { getWorkspaceRef } from '../services/workspaceStorage'

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
