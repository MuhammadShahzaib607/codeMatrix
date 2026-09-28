const sessions = new Map()

const MAX_SESSIONS = 200
const KEEP_SESSION_MESSAGES = 40
const SESSION_TOOL_RESULT_MAX = 2000

export function trimSessionMessages(messages) {
  if (!Array.isArray(messages)) return []
  const kept = messages.length > KEEP_SESSION_MESSAGES
    ? messages.slice(messages.length - KEEP_SESSION_MESSAGES)
    : messages.slice()
  return kept.map((message) => {
    if (!message || typeof message !== 'object') return message
    if (message.role === 'tool' && typeof message.content === 'string') {
      return {
        ...message,
        content:
          message.content.length > SESSION_TOOL_RESULT_MAX
            ? `${message.content.slice(0, SESSION_TOOL_RESULT_MAX)}\n[… trimmed …]`
            : message.content,
      }
    }
    return message
  })
}

function prune() {
  if (sessions.size <= MAX_SESSIONS) return
  const oldest = [...sessions.entries()].sort(
    (a, b) => (a[1].updatedAt ?? 0) - (b[1].updatedAt ?? 0),
  )
  for (const [projectId] of oldest.slice(0, sessions.size - MAX_SESSIONS)) {
    sessions.delete(projectId)
  }
}

export function saveAgentSession(
  projectId,
  { messages, plan, framework, model, provider, condensedSpec, reason = null },
) {
  if (!projectId) return null
  const record = {
    projectId: String(projectId),
    messages: trimSessionMessages(messages),
    plan: Array.isArray(plan) ? plan.slice(0, 100) : [],
    framework: framework ?? null,
    model: model ?? null,
    provider: provider ?? null,
    condensedSpec: condensedSpec ?? null,
    reason,
    updatedAt: Date.now(),
  }
  sessions.set(record.projectId, record)
  prune()
  return record
}

export function getAgentSession(projectId) {
  if (!projectId) return null
  return sessions.get(String(projectId)) ?? null
}

export function hasResumableSession(projectId) {
  const session = getAgentSession(projectId)
  return Boolean(session && Array.isArray(session.messages) && session.messages.length > 0)
}

export function clearAgentSession(projectId) {
  if (!projectId) return false
  return sessions.delete(String(projectId))
}

export const __testables = { sessions }
