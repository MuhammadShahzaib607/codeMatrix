/** "just now" / "5m ago" / "3h ago" / "2d ago" / a date for older values. */
export function formatRelativeTime(value) {
  const time = new Date(value).getTime()
  if (!Number.isFinite(time)) return 'unknown'

  const diffMs = Date.now() - time
  const minutes = Math.floor(diffMs / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`

  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`

  return new Date(time).toLocaleDateString()
}
