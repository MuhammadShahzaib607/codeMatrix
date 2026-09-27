import { createAsyncThunk, createSlice, nanoid } from '@reduxjs/toolkit'
import { agentKeysApi, getAuthToken } from '../services/api'
import { loadSelectedKeyId, saveSelectedKeyId } from '../services/aiStorage'
import { getSocket } from '../services/socket'
import { scratchProjectIdFor } from '../utils/workspace'
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
  keysStatus: 'idle', // idle | loading | ready | error
  keysError: null,
  selectedKeyId: loadSelectedKeyId(),
  framework: 'react',
  // The Groq model the LAST run actually used (resolved server-side from the
  // user's key). Shown in the panel so it is never a mystery which model ran.
  model: null,
  // Latest Groq rate-limit usage per saved key id, captured server-side from
  // real response headers. Fed by GET /api/keys/usage and by the live
  // 'agent:usage' socket event. A key with no entry has never been used.
  usageByKeyId: {},
  usageStatus: 'idle', // idle | loading | ready | error
  usageError: null,
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
 * when Settings opens and after a run finishes; during a run the 'agent:usage'
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
  async ({ key, label }, { dispatch, rejectWithValue }) => {
    try {
      const data = await agentKeysApi.create(key, label)
      dispatch(showToast({ message: 'Groq API key saved.', type: 'success' }))
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
  async ({ projectId, task }, { dispatch, getState, rejectWithValue }) => {
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
        const userId = getState().auth.user?.id
        const scratchId = scratchProjectIdFor(userId)
        const data = await dispatch(openScratchWorkspace({ projectId: scratchId })).unwrap()
        activeProjectId = data?.projectId ?? scratchId
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
            keyId: ai.selectedKeyId,
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

    selectKeyId(state, action) {
      state.selectedKeyId = action.payload
    },

    setKeys(state, action) {
      state.keys = action.payload ?? []
      state.keysStatus = 'ready'
      state.keysError = null
    },

    /** One live usage snapshot streamed over the socket ('agent:usage'). */
    usageUpdated(state, action) {
      const record = action.payload
      if (!record?.keyId) return
      state.usageByKeyId = { ...state.usageByKeyId, [record.keyId]: record }
    },

    agentStarted(state, action) {
      state.running = true
      state.thinking = true
      state.thinkingText = 'Sending the task to the agent…'
      state.timeline.push({ id: nanoid(), kind: 'user', text: action.payload.task })
    },

    /**
     * One streamed agent:action event. 'thinking' just moves the animated
     * indicator; everything else lands in the timeline, UPSERTED by actionId so
     * the running/done pair for one tool call updates a single row.
     */
    agentAction(state, action) {
      const event = action.payload ?? {}
      // Any event that carries the resolved model updates the panel label.
      if (event.details?.model) state.model = String(event.details.model)
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
      const { ok = true, message = '', toolCalls, durationMs, limitReached, model } = action.payload ?? {}
      if (model) state.model = String(model)
      state.running = false
      state.thinking = false
      state.thinkingText = ''
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
          if (entry?.id && entry.usage) next[entry.id] = entry.usage
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
  selectKeyId,
  setKeys,
  usageUpdated,
  agentStarted,
  agentAction,
  agentDone,
  clearTimeline,
} = aiSlice.actions

export default aiSlice.reducer
