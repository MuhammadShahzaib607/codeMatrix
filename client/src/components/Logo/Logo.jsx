import { useState } from 'react'

/**
 * App logo, served root-relative from client/public/logo.png.
 *
 * Use a root-relative path (never an import) so the same URL works in dev and
 * in a production build. If the image is missing or fails to load, a styled
 * "CM" badge is rendered instead so the UI never shows a broken-image icon.
 *
 * @param {number} size  height in px; width follows the aspect ratio
 */
export default function Logo({ size = 28, className = '', alt = 'CodeMatrix logo' }) {
  const [failed, setFailed] = useState(false)

  if (failed) {
    return (
      <span
        className={`logo-fallback ${className}`.trim()}
        style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
        role="img"
        aria-label="CodeMatrix logo"
      >
        CM
      </span>
    )
  }

  return (
    <img
      className={`app-logo ${className}`.trim()}
      src="/logo.png"
      alt={alt}
      style={{ height: size, width: 'auto' }}
      onError={() => {
        console.warn(
          '[Logo] /logo.png could not be loaded (is client/public/logo.png present?). Falling back to the "CM" badge.',
        )
        setFailed(true)
      }}
    />
  )
}
