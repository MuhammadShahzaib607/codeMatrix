/**
 * Copies text to the clipboard.
 *
 * Prefers the async Clipboard API (needs a secure context — localhost counts)
 * and falls back to a hidden textarea + execCommand for browsers/contexts where
 * writeText is unavailable or rejects (e.g. a non-focused document).
 *
 * @returns {Promise<boolean>} whether the copy is believed to have succeeded
 */
export async function copyTextToClipboard(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {}

  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.top = '-1000px'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const copied = document.execCommand('copy')
    document.body.removeChild(area)
    return copied
  } catch {
    return false
  }
}
