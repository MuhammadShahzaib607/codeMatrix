import './UsageBar.css'

/**
 * A thin progress bar for one Groq budget (requests-per-day or tokens-per-minute).
 *
 * `usedPercent` drives both the fill width and the color tone:
 *   < 70%  -> accent/green, 70-90% -> orange, 90%+ -> red.
 *
 * The same component is used by Settings (full label + fraction) and the AI
 * panel (compact), so the numbers can never drift between the two views.
 */
export default function UsageBar({
  label,
  used,
  limit,
  usedPercent,
  tone = 'ok',
  compact = false,
  title,
}) {
  const width = Number.isFinite(usedPercent) ? Math.min(100, Math.max(0, usedPercent)) : 0

  return (
    <div
      className={`usage-bar is-${tone} ${compact ? 'is-compact' : ''}`}
      title={title}
      role="group"
      aria-label={label}
    >
      {!compact && (
        <div className="usage-bar-head">
          <span className="usage-bar-label">{label}</span>
          <span className="usage-bar-fraction">
            {used} / {limit} used
          </span>
        </div>
      )}
      <div
        className="usage-bar-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={width}
        aria-label={compact ? `${label} usage` : label}
      >
        <div className="usage-bar-fill" style={{ width: `${width}%` }} />
      </div>
    </div>
  )
}
