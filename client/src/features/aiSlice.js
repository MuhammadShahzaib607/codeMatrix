import { createAsyncThunk, createSlice, nanoid } from '@reduxjs/toolkit'
import { agentKeysApi, getAuthToken } from '../services/api'
import {
  loadModelPreference,
  loadProviderPreference,
  loadSelectedKeyId,
  saveSelectedKeyId,
} from '../services/aiStorage'
import { AUTO_MODEL, modelParts } from '../utils/agentModels'
import { getSocket } from '../services/socket'
import { showToast } from './uiSlice'
import { openScratchWorkspace } from './workspaceThunks'

// ---------------------------------------------------------------------------
// Everything the AI panel shows:
//
//   timeline   one ordered list per task run:
//              { kind:'user', text }        the request
//              { kind:'action', …event }    one live agent action (upserted by
//                                           actionId: "running" -> "done")
//              { kind:'agent', text, ok }   the final summary (or the error)
//   running    an agent run is in flight (input locked, animated indicator)
//   keys       the user's SAVED keys, masked (full key never reaches the client)
//   framework  selected stack for the next task
//   selectedKeyId  which saved key the run uses (null = newest)
// ---------------------------------------------------------------------------

const initialState = {
  keys: [],
  providers: [],
  keysStatus: 'idle', // idle | loading | ready | error
  keysError: null,
  selectedKeyId: loadSelectedKeyId(),
  framework: 'react',
  // The model preference chosen in the panel. AUTO_MODEL lets the server pick
  // the allowlisted model with the most remaining per-minute budget.
  modelChoice: loadModelPreference(null),
  // Auto (default) / Mistral first / Groq first.
  providerPreference: loadProviderPreference(null),
  // The provider + model the CURRENT run resolved (streamed from the server).
  // The header always reflects what the last request actually used.
  provider: null,
  model: null,
  // True when the last run ended in an error or hit the tool cap, so the panel
  // can offer a Continue button that resumes from the saved session.
  canContinue: false,
  // Per-key usage envelope: { id, provider, providerLabel, label, masked,
  // model, models, summary, status, lastUpdated }. summary is the server's
  // usage ledger for the key's active model; status is active/cooling/invalid.
  usageByKeyId: {},
  usageStatus: 'idle', // idle | loading | ready | error
  usageError: null,
  // Totals for the task currently running: { totalTokens, requests }.
  usageTask: null,
  // Live header state while a run waits for a reset or switches provider.
  waitingMs: 0,
  switchingTo: null,
  running: false,
  thinking: false,
  thinkingText: '',
  timeline: [],
}

// ---------------------------------------------------------------------------
// Key management thunks
// ---------------------------------------------------------------------------

export const fetchApiKeys = createAsyncThunk('ai/fetchKeys', async (_, { rejectWithValue }) => {
  try {
    return await agentKeysApi.list()
  } catch (error) {
    return rejectWithValue(error.message)
  }
})

/**
 * The latest CAPTURED Groq usage for every saved key (no fresh Groq call). Used
 * when Settings opens and after a run finishes; during a run the 'usage:update'
 * socket event updates the same state live.
 */
export const fetchKeyUsage = createAsyncThunk(
  'ai/fetchKeyUsage',
  async (_, { rejectWithValue }) => {
    try {
      return await agentKeysApi.usage()
    } catch (error) {
      return rejectWithValue(error.message)
    }
  },
)

export const addApiKey = createAsyncThunk(
  'ai/addKey',
  async ({ provider, key, label }, { dispatch, rejectWithValue }) => {
    try {
      const data = await agentKeysApi.create(provider, key, label)
      dispatch(showToast({ message: 'API key saved and verified.', type: 'success' }))
      await dispatch(fetchApiKeys())
      return data
    } catch (error) {
      dispatch(showToast({ message: error.message, type: 'error' }))
      return rejectWithValue(error.message)
    }
  },
)

export const deleteApiKey = createAsyncThunk(
  'ai/deleteKey',
  async (keyId, { dispatch, getState, rejectWithValue }) => {
    try {
      await agentKeysApi.remove(keyId)
      if (getState().ai.selectedKeyId === keyId) {
        dispatch(aiSlice.actions.selectKeyId(null))
        saveSelectedKeyId(null)
      }
      dispatch(showToast({ message: 'API key deleted.', type: 'success' }))
      await dispatch(fetchApiKeys())
      return { keyId }
    } catch (error) {
      dispatch(showToast({ message: error.message, type: 'error' }))
      return rejectWithValue(error.message)
    }
  },
)

/**
 * Reveals ONE saved key after the user re-enters their account password. The
 * server verifies the password against the login hash and only then decrypts;
 * a wrong password rejects with a clear message and never returns key data.
 */
export const revealApiKey = createAsyncThunk(
  'ai/revealKey',
  async ({ keyId, password }, { rejectWithValue }) => {
    try {
      const data = await agentKeysApi.reveal(keyId, password)
      return { keyId, value: data?.key?.value ?? '' }
    } catch (error) {
      return rejectWithValue(error.message)
    }
  },
)

/**
 * Updates a saved key's label and/or replaces its value. Same password gate as
 * reveal; the new value is re-encrypted server-side.
 */
export const updateApiKey = createAsyncThunk(
  'ai/updateKey',
  async ({ keyId, password, label, key }, { dispatch, rejectWithValue }) => {
    try {
      const data = await agentKeysApi.update(keyId, { password, label, key })
      dispatch(showToast({ message: 'API key updated.', type: 'success' }))
      await dispatch(fetchApiKeys())
      return data
    } catch (error) {
      dispatch(showToast({ message: error.message, type: 'error' }))
      return rejectWithValue(error.message)
    }
  },
)

// ---------------------------------------------------------------------------
// Starting a run
// ---------------------------------------------------------------------------

/**
 * Sends the task over the agent socket. The ACK only says "the run started
 * (or why it could not)"; every step afterwards arrives as 'agent:action'
 * events, handled by hooks/useAgentEvents.js.
 */
export const startAgentTask = createAsyncThunk(
  'ai/startTask',
  async ({ projectId, task, resume = false }, { dispatch, getState, rejectWithValue }) => {
    const { ai } = getState()

    // Optimistic user row + running state, so the request shows immediately.
    dispatch(agentStarted({ task }))

    try {
      // The agent only needs a workspace to write into, and one ALWAYS exists:
      // an imported project, or the per-user scratch workspace (created on
      // demand). So an empty/absent workspace is bootstrapped here rather than
      // blocking the run — the agent's first tool calls then create the files.
      let activeProjectId = projectId
      if (!activeProjectId) {
        // No project open: open (or reuse) the user's scratch workspace — but
        // PASS THE TASK, so the server names the workspace from it before the
        // folder exists. The agent's first file-write therefore lands in the
        // real project folder (e.g. todo-app/) and never in a "Scratch"
        // container that would have to be renamed later.
        const data = await dispatch(openScratchWorkspace({ task })).unwrap()
        activeProjectId = data?.projectId ?? null
        if (!activeProjectId) throw new Error('Could not open a workspace for the agent.')
      }

      const socket = getSocket()
      const token = getAuthToken()

      const ack = await new Promise((resolve) => {
        const timeout = setTimeout(
          () =>
            resolve({
              ok: false,
              message: 'the server did not respond. Is the API server running?',
            }),
          20000,
        )
        socket.emit(
          'agent:run',
          {
            token,
            projectId: activeProjectId,
            task,
            framework: ai.framework,
            model: modelParts(ai.modelChoice).model,
            provider: modelParts(ai.modelChoice).provider,
            providerPreference: ai.providerPreference,
            keyId: ai.selectedKeyId,
            resume: resume && Boolean(activeProjectId),
          },
          (response) => {
            clearTimeout(timeout)
            resolve(response ?? { ok: false, message: 'the server returned no response.' })
          },
        )
      })

      if (!ack?.ok) {
        throw new Error(ack?.message ?? 'the agent could not start.')
      }
      return { started: true }
    } catch (error) {
      // EVERY failure ends up as a visible agent bubble in the chat area —
      // never a silent no-op. This covers missing project/workspace, socket
      // connection problems, an expired session and a bad/unknown key id.
      const message = `Failed to reach the AI agent: ${error.message}`
      dispatch(agentDone({ ok: false, message }))
      return rejectWithValue(message)
    }
  },
)

// ---------------------------------------------------------------------------
// Reducers
// ---------------------------------------------------------------------------

const aiSlice = createSlice({
  name: 'ai',
  initialState,
  reducers: {
    setFramework(state, action) {
      state.framework = action.payload
    },

    setModelChoice(state, action) {
      state.modelChoice = action.payload || AUTO_MODEL
    },

    setProviderPreference(state, action) {
      state.providerPreference = action.payload || 'auto'
    },

    selectKeyId(state, action) {
      state.selectedKeyId = action.payload
    },

    setKeys(state, action) {
      state.keys = action.payload ?? []
      state.keysStatus = 'ready'
      state.keysError = null
    },

    /** One live usage snapshot streamed over the socket ('usage:update'). */
    usageUpdated(state, action) {
      const payload = action.payload
      if (!payload?.keyId) return
      const existing = state.usageByKeyId[payload.keyId] ?? {}
      state.usageByKeyId = {
        ...state.usageByKeyId,
        [payload.keyId]: {
          ...existing,
          id: payload.keyId,
          provider: payload.provider ?? existing.provider ?? null,
          model: payload.model ?? existing.model ?? null,
          summary: payload.summary ?? existing.summary ?? null,
          status: { status: 'active', until: null, reason: null },
          lastUpdated: payload.summary?.lastUpdated ?? existing.lastUpdated ?? null,
        },
      }
      if (payload.task) state.usageTask = payload.task
    },

    agentStarted(state, action) {
      state.running = true
      state.thinking = true
      state.thinkingText = 'Sending the task to the agent…'
      state.canContinue = false
      state.model = null
      state.provider = null
      state.usageTask = null
      state.waitingMs = 0
      state.switchingTo = null
      state.timeline.push({ id: nanoid(), kind: 'user', text: action.payload.task })
    },

    /**
     * One streamed agent:action event. 'thinking' just moves the animated
     * indicator; everything else lands in the timeline, UPSERTED by actionId so
     * the running/done pair for one tool call updates a single row.
     */
    agentAction(state, action) {
      const event = action.payload ?? {}
      // Any event that carries the resolved provider/model updates the header.
      if (event.details?.model) state.model = String(event.details.model)
      if (event.details?.provider) state.provider = String(event.details.provider)

      const details = event.details ?? {}
      if (details.waitingMs != null) {
        state.waitingMs = details.waitingMs
      } else if (event.type !== 'note') {
        state.waitingMs = 0
      }
      if (details.switchTo) {
        state.switchingTo = details.switchTo
      } else if (event.type !== 'fallback' && event.type !== 'note') {
        state.switchingTo = null
      }

      if (event.type === 'thinking') {
        state.thinking = true
        state.thinkingText = event.description || 'Working…'
        return
      }

      // 'complete' / 'error' events mirror what agent:done carries; the run's
      // final message is rendered once as the summary bubble at the end.
      if (event.type === 'complete' || event.type === 'error') {
        state.thinking = false
        state.thinkingText = ''
        state.waitingMs = 0
        state.switchingTo = null
        return
      }

      state.thinking = false
      state.thinkingText = ''

      const existing = state.timeline.find(
        (entry) => entry.kind === 'action' && entry.id === event.actionId,
      )
      if (existing) {
        existing.type = event.type
        existing.description = event.description
        existing.details = event.details ?? existing.details
        existing.status = event.details?.status ?? existing.status
        return
      }
      state.timeline.push({
        id: event.actionId ?? nanoid(),
        kind: 'action',
        type: event.type,
        description: event.description ?? '',
        details: event.details ?? {},
        status: event.details?.status ?? 'done',
        at: event.at ?? Date.now(),
      })
    },

    agentDone(state, action) {
      const { ok = true, message = '', toolCalls, durationMs, limitReached, model, provider } =
        action.payload ?? {}
      if (model) state.model = String(model)
      if (provider) state.provider = String(provider)
      state.running = false
      state.thinking = false
      state.thinkingText = ''
      state.waitingMs = 0
      state.switchingTo = null
      state.canContinue = !ok || Boolean(limitReached)
      state.timeline.push({
        id: nanoid(),
        kind: 'agent',
        text: message,
        ok: Boolean(ok),
        toolCalls,
        durationMs,
        limitReached: Boolean(limitReached),
      })
    },

    clearTimeline(state) {
      if (state.running) return
      state.timeline = []
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchApiKeys.pending, (state) => {
        state.keysStatus = 'loading'
        state.keysError = null
      })
      .addCase(fetchApiKeys.fulfilled, (state, action) => {
        state.keys = action.payload?.keys ?? []
        if (Array.isArray(action.payload?.providers)) state.providers = action.payload.providers
        state.keysStatus = 'ready'
        state.keysError = null
        // Drop a stale selection whose key was deleted elsewhere.
        if (state.selectedKeyId && !state.keys.some((key) => key.id === state.selectedKeyId)) {
          state.selectedKeyId = null
        }
      })
      .addCase(fetchApiKeys.rejected, (state, action) => {
        state.keysStatus = 'error'
        state.keysError = action.payload ?? 'Could not load API keys.'
      })
      .addCase(fetchKeyUsage.pending, (state) => {
        state.usageStatus = 'loading'
      })
      .addCase(fetchKeyUsage.fulfilled, (state, action) => {
        state.usageStatus = 'ready'
        state.usageError = null
        const next = { ...state.usageByKeyId }
        for (const entry of action.payload?.keys ?? []) {
          if (!entry?.id) continue
          next[entry.id] = { ...(next[entry.id] ?? {}), ...entry }
        }
        state.usageByKeyId = next
      })
      .addCase(fetchKeyUsage.rejected, (state, action) => {
        state.usageStatus = 'error'
        state.usageError = action.payload ?? 'Could not load API usage.'
      })
  },
})

export const {
  setFramework,
  setModelChoice,
  setProviderPreference,
  selectKeyId,
  setKeys,
  usageUpdated,
  agentStarted,
  agentAction,
  agentDone,
  clearTimeline,
} = aiSlice.actions

export default aiSlice.reducer
