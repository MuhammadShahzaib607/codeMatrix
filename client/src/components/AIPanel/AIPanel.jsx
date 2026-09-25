import { Bot, Send, Sparkles, User } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import './AIPanel.css'

// Static sample conversation — no real model calls yet.
const initialMessages = [
  {
    id: 'm1',
    role: 'ai',
    text: 'Hi! I am your AI assistant. Ask me to explain, refactor or generate code for the file you are editing.',
  },
  {
    id: 'm2',
    role: 'user',
    text: 'Can you add a counter to App.jsx using the useState hook?',
  },
  {
    id: 'm3',
    role: 'ai',
    text: 'Sure — here is a minimal counter you can drop into App.jsx:',
    code: `import { useState } from 'react'

export default function App() {
  const [count, setCount] = useState(0)

  return (
    <button onClick={() => setCount(count + 1)}>
      Clicked {count} times
    </button>
  )
}`,
  },
]

const SUGGESTIONS = ['Explain this file', 'Find bugs', 'Add tests']

export default function AIPanel() {
  const [messages, setMessages] = useState(initialMessages)
  const [draft, setDraft] = useState('')
  const scrollRef = useRef(null)

  useEffect(() => {
    const element = scrollRef.current
    if (element) element.scrollTop = element.scrollHeight
  }, [messages])

  function handleSend(event) {
    event.preventDefault()
    const text = draft.trim()
    if (!text) return
    setMessages((current) => [...current, { id: `m${current.length + 1}`, role: 'user', text }])
    setDraft('')
  }

  return (
    <aside className="ai-panel">
      <div className="ai-header">
        <Sparkles size={16} className="ai-header-icon" />
        <span className="ai-header-title">AI Assistant</span>
        <span className="ai-badge">Preview</span>
      </div>

      <div className="ai-messages" ref={scrollRef}>
        {messages.map((message) => (
          <div key={message.id} className={`ai-message is-${message.role}`}>
            <div className="ai-avatar">
              {message.role === 'ai' ? <Bot size={14} /> : <User size={14} />}
            </div>
            <div className="ai-bubble">
              <p className="ai-text">{message.text}</p>
              {message.code && (
                <pre className="ai-code">
                  <code>{message.code}</code>
                </pre>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="ai-suggestions">
        {SUGGESTIONS.map((suggestion) => (
          <button
            type="button"
            key={suggestion}
            className="ai-suggestion"
            onClick={() => setDraft(suggestion)}
          >
            {suggestion}
          </button>
        ))}
      </div>

      <form className="ai-composer" onSubmit={handleSend}>
        <input
          className="ai-input"
          value={draft}
          placeholder="Ask the AI assistant…"
          onChange={(event) => setDraft(event.target.value)}
        />
        <button
          type="submit"
          className="ai-send"
          title="Send"
          aria-label="Send message"
          disabled={!draft.trim()}
        >
          <Send size={16} />
        </button>
      </form>
    </aside>
  )
}
