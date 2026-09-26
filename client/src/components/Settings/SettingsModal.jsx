import {
  Bot,
  Check,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  LogOut,
  Palette,
  Pencil,
  Plus,
  Search,
  Settings2,
  TerminalSquare,
  Trash2,
  User,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { addApiKey, deleteApiKey, fetchApiKeys, selectKeyId } from '../../features/aiSlice'
import { logout } from '../../features/authSlice'
import {
  closeSettings,
  resetSettings,
  setSettingsSection,
  setTheme,
  updateEditorSetting,
  updateTerminalSetting,
} from '../../features/settingsSlice'
import { openDeleteProjectModal, showToast } from '../../features/uiSlice'
import { saveSelectedKeyId } from '../../services/aiStorage'
import { THEMES } from '../../utils/themes'
import { isCloudWorkspace } from '../../utils/workspace'
import KeyAccessModal from './KeyAccessModal'
import './SettingsModal.css'

// A revealed key hides itself again after this long, even if the user stays in
// the dialog — and it always re-masks when Settings closes.
const REVEAL_HIDE_MS = 30000

const SECTIONS = [
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'editor', label: 'Editor', icon: Settings2 },
  { id: 'terminal', label: 'Terminal', icon: TerminalSquare },
  { id: 'ai', label: 'AI Assistant', icon: Bot },
  { id: 'general', label: 'General', icon: User },
]

// The order categories are shown in. Anything not listed falls to the end.
const CATEGORY_ORDER = ['dark', 'light', 'colorful', 'high-contrast']

const FONT_OPTIONS = [
  { value: '', label: 'System Default (monospace)' },
  { value: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace", label: 'Cascadia Code' },
  { value: "'Fira Code', 'Cascadia Code', monospace", label: 'Fira Code' },
  { value: "'JetBrains Mono', 'Cascadia Code', monospace", label: 'JetBrains Mono' },
  { value: "'Consolas', 'Courier New', monospace", label: 'Consolas' },
  { value: "'Source Code Pro', 'Cascadia Code', monospace", label: 'Source Code Pro' },
  { value: "'Monaco', 'Menlo', 'Consolas', monospace", label: 'Monaco' },
  { value: "'Menlo', 'Consolas', monospace", label: 'Menlo' },
  { value: "'Courier New', monospace", label: 'Courier New' },
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
  const workspace = useSelector((state) => state.fileSystem.workspace)
  const user = useSelector((state) => state.auth.user)
  const isAuthenticated = useSelector((state) => state.auth.isAuthenticated)
  const ai = useSelector((state) => state.ai)
  const [themeQuery, setThemeQuery] = useState('')
  const [newKey, setNewKey] = useState('')
  const [newKeyLabel, setNewKeyLabel] = useState('')
  const [isSavingKey, setIsSavingKey] = useState(false)
  // { mode: 'reveal' | 'edit', key } for the password-gated dialog.
  const [keyAccess, setKeyAccess] = useState(null)
  // The one key currently shown in full ({ id, value }); null = all masked.
  const [revealedKey, setRevealedKey] = useState(null)

  // Refresh the masked key list every time Settings opens.
  useEffect(() => {
    if (isOpen && isAuthenticated) dispatch(fetchApiKeys())
  }, [isOpen, isAuthenticated, dispatch])

  // Re-mask a revealed key shortly after it is shown.
  useEffect(() => {
    if (!revealedKey) return undefined
    const timer = setTimeout(() => setRevealedKey(null), REVEAL_HIDE_MS)
    return () => clearTimeout(timer)
  }, [revealedKey])

  // Closing Settings always re-masks any revealed key and dismisses the dialog,
  // so plaintext never survives leaving the view. Kept in the event handlers
  // (not an effect) to avoid a needless render cascade.
  function dismissSettings() {
    setRevealedKey(null)
    setKeyAccess(null)
    dispatch(closeSettings())
  }

  useEffect(() => {
    if (!isOpen) return undefined
    function onKeyDown(event) {
      if (event.key !== 'Escape') return
      setRevealedKey(null)
      setKeyAccess(null)
      dispatch(closeSettings())
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [isOpen, dispatch])

  // Filter + group the full theme list. The list is data-driven, so this works
  // no matter how many themes utils/themes.js contains.
  const themeGroups = useMemo(() => {
    const query = themeQuery.trim().toLowerCase()
    const matching = query
      ? THEMES.filter(
          (option) =>
            option.name.toLowerCase().includes(query) ||
            option.categoryLabel.toLowerCase().includes(query),
        )
      : THEMES

    const byCategory = new Map()
    for (const option of matching) {
      if (!byCategory.has(option.category)) byCategory.set(option.category, [])
      byCategory.get(option.category).push(option)
    }

    const known = CATEGORY_ORDER.filter((key) => byCategory.has(key))
    const extra = [...byCategory.keys()].filter((key) => !CATEGORY_ORDER.includes(key))
    return [...known, ...extra].map((key) => ({
      key,
      label: byCategory.get(key)[0].categoryLabel,
      themes: byCategory.get(key),
    }))
  }, [themeQuery])

  if (!isOpen) return null

  const selectedShell = terminal.preferredShell ?? defaultShell ?? ''
  const activeTheme = THEMES.find((option) => option.id === theme)
  const canDeleteProject = isCloudWorkspace(workspace)

  async function handleAddKey(event) {
    event.preventDefault()
    const key = newKey.trim()
    if (!key || isSavingKey) return
    setIsSavingKey(true)
    const result = await dispatch(addApiKey({ key, label: newKeyLabel.trim() }))
    setIsSavingKey(false)
    if (addApiKey.fulfilled.match(result)) {
      setNewKey('')
      setNewKeyLabel('')
    }
  }

  function handleUseKey(keyId) {
    dispatch(selectKeyId(keyId))
    saveSelectedKeyId(keyId)
    dispatch(showToast({ message: 'Agent will use this key.', type: 'info' }))
  }

  function handleRevealed(keyId, value) {
    setRevealedKey({ id: keyId, value })
    dispatch(
      showToast({ message: 'Key revealed — it hides itself again shortly.', type: 'info' }),
    )
  }

  async function handleCopyKey(keyId, value) {
    try {
      await navigator.clipboard.writeText(value)
      dispatch(showToast({ message: 'Full key copied to the clipboard.', type: 'success' }))
    } catch {
      dispatch(showToast({ message: 'Could not copy the key to the clipboard.', type: 'error' }))
    }
    // Any copy action re-masks too, so the plaintext does not linger on screen.
    setRevealedKey((current) => (current?.id === keyId ? null : current))
  }

  return (
    <div className="settings-overlay" onMouseDown={dismissSettings}>
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
            onClick={dismissSettings}
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
                  {THEMES.length} themes, applied to the whole app immediately and saved for
                  next time.
                  {activeTheme && (
                    <>
                      {' '}
                      Active: <strong>{activeTheme.name}</strong>.
                    </>
                  )}
                </p>

                <label className="theme-search">
                  <Search size={14} />
                  <input
                    type="search"
                    className="theme-search-input"
                    placeholder="Search themes…"
                    value={themeQuery}
                    spellCheck={false}
                    onChange={(event) => setThemeQuery(event.target.value)}
                  />
                </label>

                {themeGroups.length === 0 && (
                  <p className="settings-section-desc">No themes match “{themeQuery}”.</p>
                )}

                {themeGroups.map((group) => (
                  <div key={group.key} className="theme-group">
                    <h4 className="theme-group-title">{group.label}</h4>
                    <div className="theme-grid">
                      {group.themes.map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          className={`theme-swatch ${theme === option.id ? 'is-active' : ''}`}
                          onClick={() => dispatch(setTheme(option.id))}
                          aria-pressed={theme === option.id}
                          title={option.name}
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
                  </div>
                ))}
              </section>
            )}

            {activeSection === 'editor' && (
              <section className="settings-section">
                <h3 className="settings-section-title">Editor</h3>
                <Row
                  label="Auto Save"
                  hint="Save the active file automatically after you stop typing"
                >
                  <Toggle
                    label="Auto Save"
                    checked={editor.autoSave}
                    onChange={(value) =>
                      dispatch(updateEditorSetting({ key: 'autoSave', value }))
                    }
                  />
                </Row>
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
                <Row label="Font family" hint="Fonts not installed fall back to monospace">
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

            {activeSection === 'ai' && (
              <section className="settings-section">
                <h3 className="settings-section-title">Groq API keys</h3>
                <p className="settings-section-desc">
                  The AI agent runs on a Groq API key that <strong>you</strong> provide — this app
                  ships with no built-in key. Keys are encrypted at rest with AES-256-GCM and
                  never leave the server; only masked copies are ever shown. Get one free at{' '}
                  console.groq.com → API Keys. Maximum 3 keys.
                </p>

                {!isAuthenticated ? (
                  <p className="settings-section-desc">Sign in to manage your API keys.</p>
                ) : (
                  <>
                    {ai.keysStatus === 'loading' && (
                      <p className="settings-section-desc">Loading keys…</p>
                    )}
                    {ai.keysStatus === 'error' && (
                      <p className="settings-section-desc is-error">{ai.keysError}</p>
                    )}
                    {ai.keysStatus === 'ready' && ai.keys.length === 0 && (
                      <p className="settings-section-desc">
                        No keys saved yet — paste your Groq key below to activate the assistant.
                      </p>
                    )}

                    {ai.keys.length > 0 && (
                      <div className="settings-key-list">
                        {ai.keys.map((key, index) => {
                          const inUse =
                            ai.selectedKeyId === key.id ||
                            (ai.selectedKeyId === null && index === 0)
                          const isRevealed = revealedKey?.id === key.id
                          return (
                            <div key={key.id} className="settings-key-row">
                              <KeyRound size={14} className="settings-key-icon" />
                              <div className="settings-key-info">
                                <span
                                  className={`settings-key-masked ${isRevealed ? 'is-revealed' : ''}`}
                                >
                                  {isRevealed ? revealedKey.value : key.masked}
                                </span>
                                <span className="settings-key-label">
                                  {key.label || 'No label'}
                                  {inUse ? ' · used by the agent' : ''}
                                </span>
                              </div>
                              {isRevealed && (
                                <button
                                  type="button"
                                  className="settings-btn settings-key-copy"
                                  title="Copy the full key"
                                  aria-label="Copy full API key"
                                  onClick={() => handleCopyKey(key.id, revealedKey.value)}
                                >
                                  <Copy size={13} />
                                  <span>Copy</span>
                                </button>
                              )}
                              {inUse ? (
                                <span className="settings-key-inuse">In use</span>
                              ) : (
                                <button
                                  type="button"
                                  className="settings-key-use"
                                  onClick={() => handleUseKey(key.id)}
                                >
                                  Use this
                                </button>
                              )}
                              <button
                                type="button"
                                className="settings-key-action"
                                aria-label={isRevealed ? 'Hide API key' : 'Reveal API key'}
                                title={
                                  isRevealed
                                    ? 'Hide the key again'
                                    : 'Reveal the full key (password required)'
                                }
                                onClick={() =>
                                  isRevealed
                                    ? setRevealedKey(null)
                                    : setKeyAccess({ mode: 'reveal', key })
                                }
                              >
                                {isRevealed ? <EyeOff size={13} /> : <Eye size={13} />}
                              </button>
                              <button
                                type="button"
                                className="settings-key-action"
                                aria-label={`Edit API key ${key.masked}`}
                                title="Edit this key (password required)"
                                onClick={() => setKeyAccess({ mode: 'edit', key })}
                              >
                                <Pencil size={13} />
                              </button>
                              <button
                                type="button"
                                className="settings-key-delete"
                                aria-label={`Delete API key ${key.masked}`}
                                title="Delete this key"
                                onClick={() => dispatch(deleteApiKey(key.id))}
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          )
                        })}
                      </div>
                    )}

                    {ai.keys.length < 3 ? (
                      <form className="settings-key-form" onSubmit={handleAddKey}>
                        <input
                          type="password"
                          className="settings-key-input"
                          placeholder="gsk_… (your Groq API key)"
                          value={newKey}
                          spellCheck={false}
                          autoComplete="off"
                          onChange={(event) => setNewKey(event.target.value)}
                        />
                        <input
                          type="text"
                          className="settings-key-input settings-key-input-label"
                          placeholder="Label (optional)"
                          value={newKeyLabel}
                          maxLength={60}
                          onChange={(event) => setNewKeyLabel(event.target.value)}
                        />
                        <button
                          type="submit"
                          className="settings-btn"
                          disabled={isSavingKey || !newKey.trim()}
                        >
                          <Plus size={14} />
                          <span>{isSavingKey ? 'Saving…' : 'Add key'}</span>
                        </button>
                      </form>
                    ) : (
                      <p className="settings-section-desc">
                        <strong>Maximum 3 API keys allowed.</strong> Delete one before adding
                        another.
                      </p>
                    )}
                  </>
                )}
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
                        dismissSettings()
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

                {canDeleteProject && (
                  <>
                    <h3 className="settings-section-title settings-section-title-spaced">
                      Project
                    </h3>
                    <p className="settings-section-desc">
                      Permanently deletes “{workspace.name}” — every file in its workspace folder
                      plus its project record. This cannot be undone.
                    </p>
                    <button
                      type="button"
                      className="settings-btn is-danger"
                      onClick={() => {
                        dismissSettings()
                        dispatch(openDeleteProjectModal())
                      }}
                    >
                      <Trash2 size={14} />
                      <span>Delete this project</span>
                    </button>
                  </>
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

      {keyAccess && (
        <KeyAccessModal
          mode={keyAccess.mode}
          keyMeta={keyAccess.key}
          onClose={() => setKeyAccess(null)}
          onRevealed={(value) => handleRevealed(keyAccess.key.id, value)}
        />
      )}
    </div>
  )
}
