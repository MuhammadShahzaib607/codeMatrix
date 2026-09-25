import { useCallback } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { openAuthModal } from '../features/uiSlice'

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
