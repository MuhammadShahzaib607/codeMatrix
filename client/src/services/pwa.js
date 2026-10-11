import { showToast } from '../features/uiSlice'

const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000

let waitingWorker = null
let reloadRequested = false

export function applyServiceWorkerUpdate() {
  if (waitingWorker) {
    reloadRequested = true
    waitingWorker.postMessage('SKIP_WAITING')
    return
  }
  window.location.reload()
}

export function registerServiceWorker(store) {
  if (!('serviceWorker' in navigator)) return
  const hadController = Boolean(navigator.serviceWorker.controller)

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadRequested) window.location.reload()
  })

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        const announce = (worker) => {
          waitingWorker = worker
          store.dispatch(
            showToast({
              message: 'New version available, reload',
              type: 'info',
              action: { kind: 'reload', label: 'Reload' },
            }),
          )
        }

        if (registration.waiting && hadController) announce(registration.waiting)

        registration.addEventListener('updatefound', () => {
          const worker = registration.installing
          if (!worker) return
          worker.addEventListener('statechange', () => {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) announce(worker)
          })
        })

        setInterval(() => {
          registration.update().catch(() => {})
        }, UPDATE_CHECK_INTERVAL_MS)
      })
      .catch(() => {})
  })
}
