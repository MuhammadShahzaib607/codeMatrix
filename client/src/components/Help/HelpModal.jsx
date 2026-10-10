import { Check, Copy, X } from 'lucide-react'
import { Fragment, useEffect, useRef, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { closeHelpModal, showToast } from '../../features/uiSlice'
import { copyTextToClipboard } from '../../utils/clipboard'
import { HELP_TOPICS } from './helpTopics'
import './HelpModal.css'

function renderText(text) {
  return String(text)
    .split('`')
    .map((part, index) =>
      index % 2 === 1 ? (
        <code key={index} className="help-inline-code">
          {part}
        </code>
      ) : (
        <Fragment key={index}>{part}</Fragment>
      ),
    )
}

function CommandBlock({ copyKey, text, copied, onCopy }) {
  return (
    <div className="help-code">
      <code className="help-code-text">{text}</code>
      <button
        type="button"
        className={`help-copy-btn ${copied ? 'is-copied' : ''}`}
        onClick={() => onCopy(copyKey, text)}
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
        <span>{copied ? 'Copied' : 'Copy'}</span>
      </button>
    </div>
  )
}

export default function HelpModal() {
  const dispatch = useDispatch()
  const isOpen = useSelector((state) => state.ui.isHelpModalOpen)
  const [activeTopicId, setActiveTopicId] = useState(HELP_TOPICS[0].id)
  const [copiedKey, setCopiedKey] = useState(null)
  const cardRef = useRef(null)
  const copiedTimerRef = useRef(null)

  useEffect(
    () => () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
    },
    [],
  )

  useEffect(() => {
    if (!isOpen) return undefined
    setCopiedKey(null)
    const previousFocus = document.activeElement
    const card = cardRef.current
    const focusables = () =>
      Array.from(
        card?.querySelectorAll('button:not(:disabled), [href], input, [tabindex]:not([tabindex="-1"])') ?? [],
      )
    focusables()[0]?.focus()

    function onKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        dispatch(closeHelpModal())
        return
      }
      if (event.key !== 'Tab' || !card) return
      const items = focusables()
      if (!items.length) return
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (event.shiftKey && (active === first || !card.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (active === last || !card.contains(active))) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      if (previousFocus instanceof HTMLElement) previousFocus.focus()
    }
  }, [isOpen, dispatch])

  if (!isOpen) return null

  const topic = HELP_TOPICS.find((entry) => entry.id === activeTopicId) ?? HELP_TOPICS[0]

  async function handleCopy(copyKey, text) {
    const copied = await copyTextToClipboard(text)
    if (!copied) {
      dispatch(showToast({ message: 'Could not access the clipboard.', type: 'error' }))
      return
    }
    setCopiedKey(copyKey)
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
    copiedTimerRef.current = setTimeout(() => setCopiedKey(null), 1600)
  }

  function dismiss() {
    dispatch(closeHelpModal())
  }

  return (
    <div className="help-overlay" onMouseDown={dismiss}>
      <div
        className="help-card"
        role="dialog"
        aria-modal="true"
        aria-label="Help"
        ref={cardRef}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="help-titlebar">
          <span className="help-title">Help</span>
          <button type="button" className="help-close" aria-label="Close help" onClick={dismiss}>
            <X size={16} />
          </button>
        </div>

        <div className="help-body">
          <nav className="help-nav" aria-label="Help topics">
            {HELP_TOPICS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={`help-nav-item ${entry.id === topic.id ? 'is-active' : ''}`}
                aria-current={entry.id === topic.id ? 'page' : undefined}
                onClick={() => setActiveTopicId(entry.id)}
              >
                <span>{entry.label}</span>
              </button>
            ))}
          </nav>

          <div className="help-content">
            <h3 className="help-topic-title">{topic.label}</h3>
            {topic.intro && <p className="help-paragraph">{renderText(topic.intro)}</p>}

            {topic.sections.map((section) => (
              <section key={section.id} className="help-section">
                <h4 className="help-section-title">{section.title}</h4>

                {(section.body ?? []).map((paragraph, index) => (
                  <p key={index} className="help-paragraph">
                    {renderText(paragraph)}
                  </p>
                ))}

                {(section.commands ?? []).map((command, index) => (
                  <CommandBlock
                    key={index}
                    copyKey={`${section.id}:cmd:${index}`}
                    text={command}
                    copied={copiedKey === `${section.id}:cmd:${index}`}
                    onCopy={handleCopy}
                  />
                ))}

                {section.items && (
                  <ul className="help-list">
                    {section.items.map((item, index) => (
                      <li key={index} className="help-list-item">
                        <p className="help-paragraph">{renderText(item.text)}</p>
                        {(item.commands ?? []).map((command, commandIndex) => (
                          <CommandBlock
                            key={commandIndex}
                            copyKey={`${section.id}:item:${index}:${commandIndex}`}
                            text={command}
                            copied={
                              copiedKey === `${section.id}:item:${index}:${commandIndex}`
                            }
                            onCopy={handleCopy}
                          />
                        ))}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
