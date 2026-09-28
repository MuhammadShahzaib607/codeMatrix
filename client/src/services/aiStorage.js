// Local preferences for the AI agent: which stack the selector last used in
// EACH project, and which saved Groq key the session should use. Pure
// localStorage helpers (same pattern as settingsStorage / workspaceStorage).

const FRAMEWORKS_KEY = 'code-matrix:aiFrameworks'
const KEY_ID_KEY = 'code-matrix:aiKeyId'
const MODEL_KEY = 'code-matrix:aiModel'
const PROVIDER_KEY = 'code-matrix:aiProviderPreference'

const DEFAULT_FRAMEWORK = 'react'
const DEFAULT_MODEL = 'auto'
const DEFAULT_PROVIDER_PREFERENCE = 'auto'

function readFrameworks() {
  try {
    const parsed = JSON.parse(localStorage.getItem(FRAMEWORKS_KEY) ?? '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

/** The framework last chosen for this project (falls back to React). */
export function frameworkFor(projectId) {
  if (!projectId) return DEFAULT_FRAMEWORK
  return readFrameworks()[projectId] ?? DEFAULT_FRAMEWORK
}

/** Remembers the selection per project, so it survives reloads and switches. */
export function saveFrameworkFor(projectId, framework) {
  if (!projectId || !framework) return
  try {
    const map = readFrameworks()
    map[projectId] = framework
    localStorage.setItem(FRAMEWORKS_KEY, JSON.stringify(map))
  } catch {}
}

/** Which saved key the agent should use; null = the most recently added. */
export function loadSelectedKeyId() {
  try {
    return localStorage.getItem(KEY_ID_KEY) || null
  } catch {
    return null
  }
}

export function saveSelectedKeyId(keyId) {
  try {
    if (keyId) localStorage.setItem(KEY_ID_KEY, keyId)
    else localStorage.removeItem(KEY_ID_KEY)
  } catch {}
}

function readModels() {
  try {
    const parsed = JSON.parse(localStorage.getItem(MODEL_KEY) ?? '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

/** The model choice last made by this user (defaults to Auto). */
export function loadModelPreference(userId) {
  const map = readModels()
  return map[userId || 'guest'] || DEFAULT_MODEL
}

export function saveModelPreference(userId, modelId) {
  try {
    const map = readModels()
    map[userId || 'guest'] = modelId || DEFAULT_MODEL
    localStorage.setItem(MODEL_KEY, JSON.stringify(map))
  } catch {}
}

function readProviderPreferences() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PROVIDER_KEY) ?? '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

export function loadProviderPreference(userId) {
  const map = readProviderPreferences()
  return map[userId || 'guest'] || DEFAULT_PROVIDER_PREFERENCE
}

export function saveProviderPreference(userId, preference) {
  try {
    const map = readProviderPreferences()
    map[userId || 'guest'] = preference || DEFAULT_PROVIDER_PREFERENCE
    localStorage.setItem(PROVIDER_KEY, JSON.stringify(map))
  } catch {}
}
