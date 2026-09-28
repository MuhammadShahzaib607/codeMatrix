import {
  AlertTriangle,
  Bot,
  Check,
  ChevronDown,
  Cpu,
  Eraser,
  Eye,
  FilePlus,
  FilePlus2,
  FolderCog,
  Info,
  KeyRound,
  ListChecks,
  Loader2,
  Pencil,
  Play,
  RefreshCw,
  Search,
  Send,
  Settings,
  Sparkles,
  Terminal,
  Trash2,
  User,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import {
  clearTimeline,
  fetchApiKeys,
  selectKeyId,
  setFramework,
  setModelChoice,
  setProviderPreference,
  startAgentTask,
} from '../../features/aiSlice'
import { openSettings } from '../../features/settingsSlice'
import { openAuthModal } from '../../features/uiSlice'
import useAuthGuard from '../../hooks/useAuthGuard'
import {
  frameworkFor,
  loadModelPreference,
  loadProviderPreference,
  saveFrameworkFor,
  saveModelPreference,
  saveProviderPreference,
  saveSelectedKeyId,
} from '../../services/aiStorage'
import { FRAMEWORKS } from '../../utils/agentFrameworks'
import {
  AGENT_MODELS,
  AUTO_MODEL,
  PREFERRED_PROVIDERS,
  modelLabel as modelOptionLabel,
} from '../../utils/agentModels'
import { formatCompact, keyStatusLabel, resetHint, usageMeters } from '../../utils/rateLimit'
import './AIPanel.css'

// Icon per streamed action type (spec: FilePlus=create, Pencil=edit,
// Terminal=run_command, Eye/Search=read|list, Trash2=delete).
const ACTION_ICONS = {
  create_file: FilePlus,
  append_to_file: FilePlus2,
  edit_file: Pencil,
  read_file: Eye,
  list_directory: Search,
  delete_file: Trash2,
  run_command: Terminal,
  fallback: RefreshCw,
  project: FolderCog,
  plan: ListChecks,
  note: Info,
  resume: RefreshCw,
  complete: Check,
  error: AlertTriangle,
}

const SUGGESTIONS = [
  'Create a todo app with localStorage',
  'Add a README and .gitignore',
  'Build a landing page with a contact form',
]

/** The expandable detail payload of one action row. */
function detailsText(entry) {
  const details = entry.details ?? {}
  if (entry.type === 'run_command') {
    const header = details.timedOut
      ? 'Timed out — command was killed'
      : `Exit code ${details.exitCode ?? 0}${
          details.durationMs ? ` · ${(details.durationMs / 1000).toFixed(1)}s` : ''
        }${details.shell ? ` · ${details.shell}` : ''}`
    return `${header}\n\n${details.output ?? entry.description}`
  }
  const parts = []
  if (details.result) parts.push(details.result)
  const args = details.args ?? {}
  if (Object.values(args).some((value) => value != null && value !== '')) {
    parts.push(JSON.stringify(args, null, 2))
  }
  return parts.join('\n\n') || entry.description
}

function ActionRow({ entry, expanded, onToggle }) {
  const Icon = ACTION_ICONS[entry.type] ?? Sparkles
  const isRunning = entry.status === 'running'
  const details = entry.details ?? {}
  const meta =
    entry.type === 'run_command' && !isRunning
      ? details.timedOut
        ? 'timeout'
        : `exit ${details.exitCode ?? 0}`
      : ''

  return (
    <div className={`ai-action is-${entry.type} ${isRunning ? 'is-running' : ''}`}>
      <button
        type="button"
        className="ai-action-head"
        aria-expanded={expanded}
        onClick={onToggle}
      >
        <span className="ai-action-icon">
          {isRunning ? <Loader2 size={13} className="ai-spin" /> : <Icon size={13} />}
        </span>
        <span className="ai-action-desc">{entry.description}</span>
        {meta && <span className="ai-action-meta">{meta}</span>}
        <ChevronDown size={12} className={`ai-action-chevron ${expanded ? 'is-open' : ''}`} />
      </button>
      {expanded && <pre className="ai-action-details">{detailsText(entry)}</pre>}
    </div>
  )
}

/** Custom dropdown: colored dot + label per stack (lucide has no logos). */
function FrameworkMenu({ value, onChange, disabled }) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef(null)
  const current = FRAMEWORKS.find((framework) => framework.id === value) ?? FRAMEWORKS[0]

  useEffect(() => {
    if (!open) return undefined
    function handleMouseDown(event) {
      if (!containerRef.current?.contains(event.target)) setOpen(false)
    }
    function handleKeyDown(event) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  return (
    <div className="ai-framework" ref={containerRef}>
      <button
        type="button"
        className="ai-framework-btn"
        disabled={disabled}
        title="Target stack for the next task"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((isOpen) => !isOpen)}
      >
        <span className="ai-framework-dot" style={{ background: current.color }} />
        <span className="ai-framework-label">{current.label}</span>
        <ChevronDown size={13} className={`ai-framework-chevron ${open ? 'is-open' : ''}`} />
      </button>
      {open && (
        <div className="ai-framework-menu" role="listbox" aria-label="Target framework">
          {FRAMEWORKS.map((option) => (
            <button
              key={option.id}
              type="button"
              role="option"
              aria-selected={option.id === value}
              className={`ai-framework-item ${option.id === value ? 'is-active' : ''}`}
              onClick={() => {
                onChange(option.id)
                setOpen(false)
              }}
            >
              <span className="ai-framework-dot" style={{ background: option.color }} />
              <span>{option.label}</span>
              {option.id === value && <Check size={13} />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Which Groq model the agent uses: Auto, or a specific pinned model. */
function ModelMenu({ value, onChange, disabled }) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef(null)
  const current = AGENT_MODELS.find((model) => model.id === value) ?? AGENT_MODELS[0]

  useEffect(() => {
    if (!open) return undefined
    function handleMouseDown(event) {
      if (!containerRef.current?.contains(event.target)) setOpen(false)
    }
    function handleKeyDown(event) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  return (
    <div className="ai-model-select" ref={containerRef}>
      <button
        type="button"
        className="ai-model-btn"
        disabled={disabled}
        title="Which Groq model the agent uses for the next task"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((isOpen) => !isOpen)}
      >
        <Cpu size={12} />
        <span className="ai-model-btn-label">{current.label}</span>
        <ChevronDown size={13} className={`ai-framework-chevron ${open ? 'is-open' : ''}`} />
      </button>
      {open && (
        <div className="ai-model-menu" role="listbox" aria-label="Agent model">
          {AGENT_MODELS.map((option) => (
            <button
              key={option.id}
              type="button"
              role="option"
              aria-selected={option.id === value}
              title={option.hint ?? option.label}
              className={`ai-model-item ${option.id === value ? 'is-active' : ''}`}
              onClick={() => {
                onChange(option.id)
                setOpen(false)
              }}
            >
              <span>{option.label}</span>
              {option.id === value && <Check size={13} />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function MeterBar({ label, meter }) {
  if (!meter) return null
  const reset = resetHint(meter.resetAt)
  const counted = meter.countedLocally ? ' · counted by CodeMatrix' : ''
  const title = `${label}: ${formatCompact(meter.used)} / ${formatCompact(meter.limit)} used${
    reset ? ` · ${reset}` : ''
  }${counted}`
  return (
    <div className={`ai-meter is-${meter.tone}`} title={title}>
      <span className="ai-meter-label">{label}</span>
      <span className="ai-meter-track">
        <span className="ai-meter-fill" style={{ width: `${meter.usedPercent}%` }} />
      </span>
      <span className="ai-meter-text">
        {formatCompact(meter.used)}/{formatCompact(meter.limit)}
        {reset ? ` · ${reset}` : ''}
      </span>
    </div>
  )
}

const MAX_TEXTAREA_HEIGHT = 120

export default function AIPanel() {
  const dispatch = useDispatch()
  const guard = useAuthGuard()
  const [draft, setDraft] = useState('')
  const [expandedIds, setExpandedIds] = useState(() => new Set())
  const [metersOpen, setMetersOpen] = useState(false)
  const scrollRef = useRef(null)
  const textareaRef = useRef(null)
  const metersRef = useRef(null)
  // Guards against a rapid double Enter/click dispatching two runs before
  // `running` has re-rendered true.
  const sendingRef = useRef(false)

  const {
    keys,
    providers,
    keysStatus,
    keysError,
    selectedKeyId,
    framework,
    modelChoice,
    providerPreference,
    provider,
    model,
    canContinue,
    usageByKeyId,
    usageTask,
    waitingMs,
    switchingTo,
    running,
    thinking,
    thinkingText,
    timeline,
  } = useSelector((state) => state.ai)
  const workspace = useSelector((state) => state.fileSystem.workspace)
  const isAuthenticated = useSelector((state) => state.auth.isAuthenticated)
  const userId = useSelector((state) => state.auth.user?.id ?? null)

  const projectId = workspace.projectId

  const providerLabels = {}
  for (const entry of providers) providerLabels[entry.id] = entry.label
  const providerLabelOf = (id) =>
    providerLabels[id] ?? (id ? `${id.charAt(0).toUpperCase()}${id.slice(1)}` : '')

  // The key this session's runs use: the explicit selection, else the newest
  // key (the server orders the list newest-first and defaults the same way).
  const activeKey = keys.find((key) => key.id === selectedKeyId) ?? keys[0] ?? null
  const activeEntry = activeKey ? (usageByKeyId[activeKey.id] ?? null) : null
  const activeProviderId = provider ?? activeEntry?.provider ?? activeKey?.provider ?? null
  const meters = usageMeters(activeEntry?.summary ?? null, activeProviderId)

  const modelLabel = model
    ? `${providerLabelOf(provider)} · ${model}`
    : modelChoice && modelChoice !== AUTO_MODEL
      ? modelOptionLabel(modelChoice)
      : 'Auto'
  const modelTooltip = activeKey
    ? `${modelLabel} · ${activeKey.label || activeKey.masked}`
    : `Preferred provider: ${providerLabelOf(providerPreference)}`
  const taskLine = usageTask
    ? `This task: ${formatCompact(usageTask.totalTokens)} tokens, ${usageTask.requests} request${
        usageTask.requests === 1 ? '' : 's'
      }`
    : null
  const headerStatus =
    waitingMs > 0
      ? `Waiting for reset: ${Math.ceil(waitingMs / 1000)}s`
      : switchingTo
        ? `Switching to ${providerLabelOf(switchingTo)}`
        : null

  // Keep the feed pinned to the newest action while the agent works.
  useEffect(() => {
    const element = scrollRef.current
    if (element) element.scrollTop = element.scrollHeight
  }, [timeline, thinking, thinkingText])

  useEffect(() => {
    if (!metersOpen) return undefined
    function handleMouseDown(event) {
      if (!metersRef.current?.contains(event.target)) setMetersOpen(false)
    }
    function handleKeyDown(event) {
      if (event.key === 'Escape') setMetersOpen(false)
    }
    document.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [metersOpen])

  // When the active project changes (or is restored), load ITS last-used
  // stack — the selector remembers the choice per project.
  useEffect(() => {
    dispatch(setFramework(frameworkFor(projectId)))
  }, [projectId, dispatch])

  // Each user keeps their own model preference; load it once the account is known.
  useEffect(() => {
    const stored = loadModelPreference(userId)
    if (stored !== modelChoice) dispatch(setModelChoice(stored))
  }, [userId, dispatch, modelChoice])

  useEffect(() => {
    const stored = loadProviderPreference(userId)
    if (stored !== providerPreference) dispatch(setProviderPreference(stored))
  }, [userId, dispatch, providerPreference])

  function handleFrameworkChange(frameworkId) {
    dispatch(setFramework(frameworkId))
    saveFrameworkFor(projectId, frameworkId)
  }

  function handleModelChange(modelId) {
    dispatch(setModelChoice(modelId))
    saveModelPreference(userId, modelId)
  }

  function handleProviderPreferenceChange(value) {
    dispatch(setProviderPreference(value))
    saveProviderPreference(userId, value)
  }

  function handleKeyChange(value) {
    const keyId = value || null
    dispatch(selectKeyId(keyId))
    saveSelectedKeyId(keyId)
  }

  function toggleDetails(id) {
    setExpandedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleSend(event) {
    event?.preventDefault?.()
    const task = draft.trim()
    if (!task || running || sendingRef.current) return

    if (!isAuthenticated) {
      guard(() => {}, 'Please sign in to use the AI assistant')
      return
    }

    // No workspace check here on purpose: with nothing imported the thunk opens
    // (or reuses) the scratch workspace and starts the run against it. An empty
    // workspace is normal — the agent creates the first files itself.
    const resume = canContinue && /^continue\b/i.test(task) && Boolean(projectId)
    sendingRef.current = true
    const run = () => {
      setDraft('')
      dispatch(startAgentTask({ projectId, task, resume }))
        .unwrap()
        .catch(() => {
          // The failure is already rendered as an agent error bubble in the
          // feed (see startAgentTask); swallow here to avoid an unhandled
          // rejection in the console.
        })
        .finally(() => {
          sendingRef.current = false
        })
    }
    guard(run, 'Please sign in to use the AI assistant')
  }

  function handleSuggestion(text) {
    setDraft(text)
  }

  function handleContinue() {
    if (running || sendingRef.current || !projectId) return
    if (!isAuthenticated) {
      guard(() => {}, 'Please sign in to use the AI assistant')
      return
    }
    sendingRef.current = true
    dispatch(startAgentTask({ projectId, task: 'continue', resume: true }))
      .unwrap()
      .catch(() => {})
      .finally(() => {
        sendingRef.current = false
      })
  }

  const showZeroKeyCard = isAuthenticated && keysStatus === 'ready' && keys.length === 0
  const showSignedOutCard = !isAuthenticated
  const keysFailed = keysStatus === 'error'
  // The composer must never be reachable before we KNOW a key exists — while
  // the list loads, show a quiet loading row instead of a broken chat input.
  const keysLoading = isAuthenticated && (keysStatus === 'idle' || keysStatus === 'loading')
  const showComposer =
    !showSignedOutCard && !keysLoading && !showZeroKeyCard && !keysFailed && keys.length > 0
  const showSuggestions = timeline.length === 0 && !running && showComposer

  // Auto-grow the composer: reset to "auto" so it can shrink when lines are
  // deleted, then clamp the measured content height to MAX_TEXTAREA_HEIGHT.
  // Beyond that the textarea keeps its height and scrolls internally.
  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(textarea.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`
  }, [draft, showComposer])

  return (
    <aside className="ai-panel">
      <div className="ai-header">
        <Sparkles size={16} className="ai-header-icon" />
        <span className="ai-header-title">AI Agent</span>
        <span className={`ai-badge ${running ? 'is-working' : ''}`}>
          {running ? 'Working' : 'Ready'}
        </span>        {timeline.length > 0 && !running && (
          <button
            type="button"
            className="ai-header-action"
            title="Clear this conversation"
            aria-label="Clear conversation"
            onClick={() => dispatch(clearTimeline())}
          >
            <Eraser size={14} />
          </button>
        )}
      </div>

      <div className="ai-usage-block" ref={metersRef}>
        <div className="ai-model-label">
          <button
            type="button"
            className="ai-model-chip"
            title={modelTooltip}
            aria-expanded={metersOpen}
            onClick={() => setMetersOpen((open) => !open)}
          >
            <span className="ai-model-name">{modelLabel}</span>
            {activeKey && meters?.tighter ? (
              <span className={`ai-model-usage is-${meters.tighter.tone}`}>
                {meters.tighter.remainingPercent}% left
              </span>
            ) : activeKey ? (
              <span className="ai-model-usage is-none">No usage yet</span>
            ) : null}
            <ChevronDown size={12} className={`ai-model-chevron ${metersOpen ? 'is-open' : ''}`} />
          </button>
          {headerStatus && <span className="ai-model-status">{headerStatus}</span>}
        </div>

        {activeKey && meters && (
          <div className="ai-meter-row">
            <MeterBar label="Tokens/min" meter={meters.minute} />
            <MeterBar label={meters.secondaryLabel} meter={meters.secondary} />
          </div>
        )}

        {taskLine && <span className="ai-task-total">{taskLine}</span>}

        {metersOpen && (
          <div className="ai-meters-popover">
            <div className="ai-meters-popover-head">
              <span>Saved keys</span>
              <button
                type="button"
                aria-label="Close key meters"
                onClick={() => setMetersOpen(false)}
              >
                <X size={12} />
              </button>
            </div>
            {keys.length === 0 && <p className="ai-meters-empty">No keys saved yet.</p>}
            {keys.map((key) => {
              const entry = usageByKeyId[key.id] ?? null
              const status = keyStatusLabel(entry?.status)
              const keyMeters = usageMeters(entry?.summary ?? null, key.provider ?? entry?.provider)
              return (
                <div key={key.id} className="ai-meters-key">
                  <div className="ai-meters-key-head">
                    <span className="ai-provider-badge">{providerLabelOf(key.provider)}</span>
                    <span className="ai-meters-masked">{key.masked}</span>
                    <span className={`ai-meters-status is-${status.tone}`}>{status.label}</span>
                  </div>
                  {keyMeters ? (
                    <>
                      <MeterBar label="Tokens/min" meter={keyMeters.minute} />
                      <MeterBar label={keyMeters.secondaryLabel} meter={keyMeters.secondary} />
                    </>
                  ) : (
                    <span className="ai-meters-none">No usage yet</span>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="ai-messages" ref={scrollRef}>
        {timeline.length === 0 && (
          <div className="ai-message is-ai">
            <div className="ai-avatar">
              <Bot size={14} />
            </div>
            <div className="ai-bubble">
              <p className="ai-text">
                I work directly in your project: I create and edit files, delete what is not
                needed and run shell commands (installs, builds, CLIs) until your task is done.
                Pick a stack below and describe what you want.
              </p>
            </div>
          </div>
        )}

        {timeline.map((entry) => {
          if (entry.kind === 'user') {
            return (
              <div key={entry.id} className="ai-message is-user">
                <div className="ai-avatar">
                  <User size={14} />
                </div>
                <div className="ai-bubble">
                  <p className="ai-text">{entry.text}</p>
                </div>
              </div>
            )
          }
          if (entry.kind === 'agent') {
            return (
              <div key={entry.id} className={`ai-message is-ai ${entry.ok ? '' : 'is-error'}`}>
                <div className="ai-avatar">{entry.ok ? <Bot size={14} /> : <AlertTriangle size={14} />}</div>
                <div className="ai-bubble">
                  <p className="ai-text">{entry.text}</p>
                  {entry.ok && typeof entry.toolCalls === 'number' && (
                    <p className="ai-summary-meta">
                      {entry.toolCalls} tool call{entry.toolCalls === 1 ? '' : 's'}
                      {entry.durationMs ? ` · ${(entry.durationMs / 1000).toFixed(1)}s` : ''}
                      {entry.limitReached ? ' · stopped at the tool limit' : ''}
                    </p>
                  )}
                </div>
              </div>
            )
          }
          return (
            <ActionRow
              key={entry.id}
              entry={entry}
              expanded={expandedIds.has(entry.id)}
              onToggle={() => toggleDetails(entry.id)}
            />
          )
        })}

        {running && thinking && (
          <div className="ai-thinking" role="status">
            <Loader2 size={13} className="ai-spin" />
            <span>{thinkingText || 'Thinking…'}</span>
          </div>
        )}
      </div>

      {showSuggestions && (
        <div className="ai-suggestions">
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              className="ai-suggestion"
              onClick={() => handleSuggestion(suggestion)}
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}

      {keysLoading && (
        <div className="ai-key-loading" role="status">
          <Loader2 size={13} className="ai-spin" />
          <span>Loading your API keys…</span>
        </div>
      )}

      {showSignedOutCard && (
        <div className="ai-nokey">
          <KeyRound size={16} />
          <p>Sign in to use the AI agent with your own Groq API key.</p>
          <button
            type="button"
            className="ai-nokey-btn"
            onClick={() => dispatch(openAuthModal({ mode: 'signin', message: 'Please sign in to use the AI assistant' }))}
          >
            Sign in
          </button>
        </div>
      )}

      {keysFailed && (
        <div className="ai-nokey is-error">
          <AlertTriangle size={16} />
          <p>{keysError}</p>
          <button type="button" className="ai-nokey-btn" onClick={() => dispatch(fetchApiKeys())}>
            Retry
          </button>
        </div>
      )}

      {showZeroKeyCard && (
        <div className="ai-nokey">
          <KeyRound size={16} />
          <p>Add a Groq API key in Settings to use the AI assistant.</p>
          <button type="button" className="ai-nokey-btn" onClick={() => dispatch(openSettings('ai'))}>
            Add API key
          </button>
        </div>
      )}

      {/* Framework + key controls stay visible even before a key exists (the
          stack choice is part of composing a NEW TASK); only the composer
          waits for a usable key. */}
      {!showSignedOutCard && !keysLoading && !keysFailed && (
        <div className="ai-controls">
          <FrameworkMenu value={framework} onChange={handleFrameworkChange} disabled={running} />
          <ModelMenu value={modelChoice} onChange={handleModelChange} disabled={running} />
          <select
            className="ai-pref-select"
            value={providerPreference}
            disabled={running}
            title="Preferred provider for automatic fallback"
            aria-label="Preferred provider"
            onChange={(event) => handleProviderPreferenceChange(event.target.value)}
          >
            {PREFERRED_PROVIDERS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          <div className="ai-controls-right">
            {keys.length > 1 ? (
              <select
                className="ai-key-select"
                value={selectedKeyId ?? ''}
                disabled={running}
                title="Which saved key to use for this session"
                aria-label="API key to use"
                onChange={(event) => handleKeyChange(event.target.value)}
              >
                <option value="">Newest key</option>
                {keys.map((key) => (
                  <option key={key.id} value={key.id}>
                    {key.label ? `${key.label} — ${key.masked}` : key.masked}
                  </option>
                ))}
              </select>
            ) : (
              keys.length === 1 && (
                <span className="ai-key-chip" title="The key this agent will use">
                  <KeyRound size={11} />
                  {keys[0].masked}
                </span>
              )
            )}
            <button
              type="button"
              className="ai-gear"
              title="Manage Groq API keys"
              aria-label="Manage API keys"
              onClick={() => dispatch(openSettings('ai'))}
            >
              <Settings size={14} />
            </button>
          </div>
        </div>
      )}

      {showComposer && canContinue && !running && (
        <div className="ai-continue-row">
          <button
            type="button"
            className="ai-continue-btn"
            title="Resume the last task from where it stopped"
            onClick={handleContinue}
          >
            <Play size={13} />
            Continue task
          </button>
        </div>
      )}

      {showComposer && (
        <>
          <form className="ai-composer" onSubmit={handleSend}>
            <textarea
              ref={textareaRef}
              className="ai-input ai-textarea"
              rows={1}
              value={draft}
              disabled={running}
              spellCheck={false}
              placeholder={
                running ? 'The agent is working…' : 'Describe the task for the agent…'
              }
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  handleSend(event)
                }
              }}
            />
            <button
              type="submit"
              className="ai-send"
              title="Run task"
              aria-label="Send task"
              disabled={!draft.trim() || running}
            >
              <Send size={16} />
            </button>
          </form>
        </>
      )}
    </aside>
  )
}
