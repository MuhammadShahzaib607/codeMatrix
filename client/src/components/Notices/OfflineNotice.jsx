import { WifiOff } from 'lucide-react'
import { useEffect, useState } from 'react'
import './Notices.css'

export default function OfflineNotice() {
  const [isOffline, setIsOffline] = useState(() => navigator.onLine === false)

  useEffect(() => {
    function goOnline() {
      setIsOffline(false)
    }
    function goOffline() {
      setIsOffline(true)
    }
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  if (!isOffline) return null

  return (
    <div className="offline-notice" role="status">
      <WifiOff size={15} />
      <span>The editor needs a connection. You are offline — reconnect to keep working.</span>
    </div>
  )
}
