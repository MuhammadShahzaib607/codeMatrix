import { useEffect, useState } from 'react'

export default function useInstallPrompt() {
  const [promptEvent, setPromptEvent] = useState(null)
  const [isInstalled, setIsInstalled] = useState(
    () => window.matchMedia?.('(display-mode: standalone)').matches === true,
  )

  useEffect(() => {
    function handlePrompt(event) {
      event.preventDefault()
      setPromptEvent(event)
    }
    function handleInstalled() {
      setIsInstalled(true)
      setPromptEvent(null)
    }
    const media = window.matchMedia?.('(display-mode: standalone)')
    function handleDisplayModeChange() {
      setIsInstalled(media?.matches === true)
    }

    window.addEventListener('beforeinstallprompt', handlePrompt)
    window.addEventListener('appinstalled', handleInstalled)
    media?.addEventListener?.('change', handleDisplayModeChange)
    return () => {
      window.removeEventListener('beforeinstallprompt', handlePrompt)
      window.removeEventListener('appinstalled', handleInstalled)
      media?.removeEventListener?.('change', handleDisplayModeChange)
    }
  }, [])

  const canInstall = Boolean(promptEvent) && !isInstalled

  async function promptInstall() {
    if (!promptEvent) return
    await promptEvent.prompt()
    try {
      await promptEvent.userChoice
    } catch {}
    setPromptEvent(null)
  }

  return { canInstall, isInstalled, promptInstall }
}
