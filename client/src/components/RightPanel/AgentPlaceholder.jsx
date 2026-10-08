import { Bot } from 'lucide-react'
import './AgentPlaceholder.css'

export default function AgentPlaceholder() {
  return (
    <div className="agent-placeholder">
      <div className="agent-placeholder-icon" aria-hidden="true">
        <Bot size={30} strokeWidth={1.6} />
      </div>
      <h2 className="agent-placeholder-title">Coming soon</h2>
      <p className="agent-placeholder-text">The AI agent is being worked on.</p>
    </div>
  )
}
