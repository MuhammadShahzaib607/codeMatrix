import { useCallback } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { openAuthModal } from '../features/uiSlice'

/**
 * Wraps a cloud-only action so it only runs for signed-in users. Otherwise the
 * sign-in modal opens with a short explanation. Returns the same callback shape,
 * so it can be used directly as an onClick handler.
 */
export default function useAuthGuard() {
  const dispatch = useDispatch()
  const isAuthenticated = useSelector((state) => state.auth.isAuthenticated)

  return useCallback(
    (run, message = 'Please sign in to continue') => {
      if (isAuthenticated) {
        run()
        return
      }
      dispatch(openAuthModal({ mode: 'signin', message }))
    },
    [dispatch, isAuthenticated],
  )
}
