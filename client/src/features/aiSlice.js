import { createAsyncThunk, createSlice, nanoid } from '@reduxjs/toolkit'
import { agentKeysApi, getAuthToken } from '../services/api'
import { loadSelectedKeyId, saveSelectedKeyId } from '../services/aiStorage'
import { getSocket } from '../services/socket'
import { showToast } from './uiSlice'

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
    const socket = getSocket()
    const token = getAuthToken()

    // Optimistic user row + running state, so the request shows immediately.
    dispatch(agentStarted({ task }))

    const ack = await new Promise((resolve) => {
      const timeout = setTimeout(
        () => resolve({ ok: false, message: 'The server did not respond. Is it running?' }),
        20000,
      )
      socket.emit(
        'agent:run',
        {
          token,
          projectId,
          task,
          framework: ai.framework,
          keyId: ai.selectedKeyId,
        },
        (response) => {
          clearTimeout(timeout)
          resolve(response ?? { ok: false, message: 'The server returned no response.' })
        },
      )
    })

    if (!ack?.ok) {
      const message = ack?.message ?? 'The agent could not start.'
      dispatch(agentDone({ ok: false, message }))
      return rejectWithValue(message)
    }
    return { started: true }
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
      const { ok = true, message = '', toolCalls, durationMs, limitReached } = action.payload ?? {}
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
  },
})

export const {
  setFramework,
  selectKeyId,
  setKeys,
  agentStarted,
  agentAction,
  agentDone,
  clearTimeline,
} = aiSlice.actions

export default aiSlice.reducer
