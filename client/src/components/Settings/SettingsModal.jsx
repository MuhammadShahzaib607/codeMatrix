import { Check, LogOut, Palette, Settings2, TerminalSquare, Trash2, User, X } from 'lucide-react'
import { useEffect } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { logout } from '../../features/authSlice'
import {
  closeSettings,
  resetSettings,
  setSettingsSection,
  setTheme,
  updateEditorSetting,
  updateTerminalSetting,
} from '../../features/settingsSlice'
import { showToast } from '../../features/uiSlice'
import { THEMES } from '../../utils/themes'
import './SettingsModal.css'

const SECTIONS = [
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'editor', label: 'Editor', icon: Settings2 },
  { id: 'terminal', label: 'Terminal', icon: TerminalSquare },
  { id: 'general', label: 'General', icon: User },
]

const FONT_OPTIONS = [
  { value: '', label: 'System default (SF Mono / Cascadia)' },
  { value: "'JetBrains Mono', 'SF Mono', Menlo, monospace", label: 'JetBrains Mono' },
  { value: "'Fira Code', 'Cascadia Code', monospace", label: 'Fira Code' },
  { value: "'Cascadia Code', Consolas, monospace", label: 'Cascadia Code' },
  { value: "'Menlo', 'Consolas', 'Courier New', monospace", label: 'Menlo / Consolas' },
]

function Toggle({ checked, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`settings-toggle ${checked ? 'is-on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="settings-toggle-knob" />
    </button>
  )
}

function Stepper({ value, min, max, onChange, suffix = 'px' }) {
  return (
    <div className="settings-stepper">
      <button
        type="button"
        aria-label="Decrease"
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
      >
        −
      </button>
      <span className="settings-stepper-value">
        {value}
        {suffix}
      </span>
      <button
        type="button"
        aria-label="Increase"
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
      >
        +
      </button>
    </div>
  )
}

function Row({ label, hint, children }) {
  return (
    <div className="settings-row">
      <div className="settings-row-text">
        <span className="settings-row-label">{label}</span>
        {hint && <span className="settings-row-hint">{hint}</span>}
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  )
}

export default function SettingsModal() {
  const dispatch = useDispatch()
  const { isOpen, activeSection, theme, editor, terminal } = useSelector(
    (state) => state.settings,
  )
  const { availableShells, defaultShell } = useSelector((state) => state.terminal)
  const user = useSelector((state) => state.auth.user)

  useEffect(() => {
    if (!isOpen) return undefined
    function onKeyDown(event) {
      if (event.key === 'Escape') dispatch(closeSettings())
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [isOpen, dispatch])

  if (!isOpen) return null

  const selectedShell = terminal.preferredShell ?? defaultShell ?? ''

  return (
    <div className="settings-overlay" onMouseDown={() => dispatch(closeSettings())}>
      <div
        className="settings-card"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="settings-titlebar">
          <span className="settings-title">Settings</span>
          <button
            type="button"
            className="settings-close"
            aria-label="Close settings"
            onClick={() => dispatch(closeSettings())}
          >
            <X size={16} />
          </button>
        </div>

        <div className="settings-body">
          <nav className="settings-nav">
            {SECTIONS.map((section) => (
              <button
                key={section.id}
                type="button"
                className={`settings-nav-item ${activeSection === section.id ? 'is-active' : ''}`}
                onClick={() => dispatch(setSettingsSection(section.id))}
              >
                <section.icon size={15} />
                <span>{section.label}</span>
              </button>
            ))}
          </nav>

          <div className="settings-content">
            {activeSection === 'appearance' && (
              <section className="settings-section">
                <h3 className="settings-section-title">Theme</h3>
                <p className="settings-section-desc">
                  Applies to the whole app immediately and is saved for next time.
                </p>
                <div className="theme-grid">
                  {THEMES.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className={`theme-swatch ${theme === option.id ? 'is-active' : ''}`}
                      onClick={() => dispatch(setTheme(option.id))}
                      aria-pressed={theme === option.id}
                    >
                      <span className="theme-swatch-preview">
                        {option.swatches.map((color, index) => (
                          <span key={index} style={{ background: color }} />
                        ))}
                        {theme === option.id && (
                          <span className="theme-swatch-check">
                            <Check size={13} />
                          </span>
                        )}
                      </span>
                      <span className="theme-swatch-name">{option.name}</span>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {activeSection === 'editor' && (
              <section className="settings-section">
                <h3 className="settings-section-title">Editor</h3>
                <Row label="Font size">
                  <Stepper
                    value={editor.fontSize}
                    min={12}
                    max={24}
                    onChange={(value) =>
                      dispatch(updateEditorSetting({ key: 'fontSize', value }))
                    }
                  />
                </Row>
                <Row label="Font family">
                  <select
                    className="settings-select"
                    value={editor.fontFamily}
                    onChange={(event) =>
                      dispatch(updateEditorSetting({ key: 'fontFamily', value: event.target.value }))
                    }
                  >
                    {FONT_OPTIONS.map((option) => (
                      <option key={option.label} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </Row>
                <Row label="Tab size">
                  <select
                    className="settings-select"
                    value={editor.tabSize}
                    onChange={(event) =>
                      dispatch(
                        updateEditorSetting({ key: 'tabSize', value: Number(event.target.value) }),
                      )
                    }
                  >
                    <option value={2}>2 spaces</option>
                    <option value={4}>4 spaces</option>
                  </select>
                </Row>
                <Row label="Word wrap" hint="Wrap long lines to the editor width">
                  <Toggle
                    label="Word wrap"
                    checked={editor.wordWrap}
                    onChange={(value) =>
                      dispatch(updateEditorSetting({ key: 'wordWrap', value }))
                    }
                  />
                </Row>
                <Row label="Minimap" hint="Show the code overview on the right">
                  <Toggle
                    label="Minimap"
                    checked={editor.minimap}
                    onChange={(value) =>
                      dispatch(updateEditorSetting({ key: 'minimap', value }))
                    }
                  />
                </Row>
              </section>
            )}

            {activeSection === 'terminal' && (
              <section className="settings-section">
                <h3 className="settings-section-title">Terminal</h3>
                <Row label="Default shell" hint="Used when you click + to open a terminal">
                  <select
                    className="settings-select"
                    value={selectedShell}
                    onChange={(event) =>
                      dispatch(
                        updateTerminalSetting({ key: 'preferredShell', value: event.target.value }),
                      )
                    }
                  >
                    {availableShells.length === 0 && <option value="">Loading shells…</option>}
                    {availableShells.map((shell) => (
                      <option key={shell.id} value={shell.id}>
                        {shell.label}
                      </option>
                    ))}
                  </select>
                </Row>
                <Row label="Font size">
                  <Stepper
                    value={terminal.fontSize}
                    min={10}
                    max={22}
                    onChange={(value) =>
                      dispatch(updateTerminalSetting({ key: 'fontSize', value }))
                    }
                  />
                </Row>
              </section>
            )}

            {activeSection === 'general' && (
              <section className="settings-section">
                <h3 className="settings-section-title">Account</h3>
                {user ? (
                  <div className="settings-account">
                    <span className="settings-account-avatar">
                      {(user.name || user.email || '?').charAt(0).toUpperCase()}
                    </span>
                    <div className="settings-account-info">
                      <span className="settings-account-name">{user.name}</span>
                      <span className="settings-account-email">{user.email}</span>
                    </div>
                    <button
                      type="button"
                      className="settings-btn"
                      onClick={() => {
                        dispatch(logout())
                        dispatch(closeSettings())
                        dispatch(showToast({ message: 'Signed out.', type: 'info' }))
                      }}
                    >
                      <LogOut size={14} />
                      <span>Log out</span>
                    </button>
                  </div>
                ) : (
                  <p className="settings-section-desc">Not signed in.</p>
                )}

                <h3 className="settings-section-title settings-section-title-spaced">
                  Local preferences
                </h3>
                <p className="settings-section-desc">
                  Resets the theme and all editor/terminal settings to their defaults.
                </p>
                <button
                  type="button"
                  className="settings-btn is-danger"
                  onClick={() => {
                    dispatch(resetSettings())
                    dispatch(showToast({ message: 'Local preferences reset to defaults.', type: 'success' }))
                  }}
                >
                  <Trash2 size={14} />
                  <span>Clear all local preferences</span>
                </button>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
