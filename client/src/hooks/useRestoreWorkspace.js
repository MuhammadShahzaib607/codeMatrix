import { useEffect } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { fetchRecentProjects, openRecentProject } from '../features/projectsSlice'
import { getWorkspaceRef } from '../services/workspaceStorage'

/**
 * On sign-in: load the user's existing projects (Recent Projects) and, if a
 * workspace was open last time, reopen it. Crucially this NEVER creates a
 * scratch workspace by itself — that only happens when the user explicitly
 * starts a new file/folder (see the Sidebar / AI panel), which is what stops a
 * conflicting second "Scratch" from appearing on every page load.
 */
export default function useRestoreWorkspace() {
  const dispatch = useDispatch()
  const isAuthenticated = useSelector((state) => state.auth.isAuthenticated)

  useEffect(() => {
    if (!isAuthenticated) return
    dispatch(fetchRecentProjects())

    const ref = getWorkspaceRef()
    if (!ref?.projectId) return
    // The server tells us whether the id is a scratch workspace or a real
    // project (an ADOPTED scratch keeps its id), so no guessing here.
    dispatch(openRecentProject({ projectId: ref.projectId, name: ref.name }))
  }, [isAuthenticated, dispatch])
}
