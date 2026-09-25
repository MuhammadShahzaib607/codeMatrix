import { createAsyncThunk, createSlice } from '@reduxjs/toolkit'
import { authApi, clearAuthToken, getAuthToken, setAuthToken } from '../services/api'

/**
 * Session state. The token is the source of truth: it is read from localStorage
 * on init so a reload keeps the user signed in, and fetchCurrentUser() validates
 * it against the server on app load.
 */
const storedToken = getAuthToken()

const initialState = {
  user: null,
  token: storedToken,
  // Optimistic until /me answers, so gated UI does not flicker on reload.
  isAuthenticated: Boolean(storedToken),
  loading: false,
  error: null,
}

export const registerUser = createAsyncThunk(
  'auth/register',
  async (payload, { rejectWithValue }) => {
    try {
      return await authApi.register(payload)
    } catch (error) {
      return rejectWithValue(error.message)
    }
  },
)

export const loginUser = createAsyncThunk('auth/login', async (payload, { rejectWithValue }) => {
  try {
    return await authApi.login(payload)
  } catch (error) {
    return rejectWithValue(error.message)
  }
})

export const fetchCurrentUser = createAsyncThunk(
  'auth/fetchCurrentUser',
  async (_, { rejectWithValue }) => {
    if (!getAuthToken()) return rejectWithValue({ status: 401, message: 'No session to restore.' })
    try {
      return await authApi.me()
    } catch (error) {
      // Keep the status so the reducer can tell "bad token" (sign out) apart
      // from "server unreachable" (stay signed in optimistically).
      return rejectWithValue({ status: error.status, message: error.message })
    }
  },
)

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    logout(state) {
      clearAuthToken()
      state.user = null
      state.token = null
      state.isAuthenticated = false
      state.loading = false
      state.error = null
    },

    clearAuthError(state) {
      state.error = null
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(registerUser.pending, startLoading)
      .addCase(registerUser.fulfilled, applySession)
      .addCase(registerUser.rejected, applyFailure)

      .addCase(loginUser.pending, startLoading)
      .addCase(loginUser.fulfilled, applySession)
      .addCase(loginUser.rejected, applyFailure)

      .addCase(fetchCurrentUser.pending, startLoading)
      .addCase(fetchCurrentUser.fulfilled, (state, action) => {
        state.loading = false
        state.user = action.payload.user
        state.isAuthenticated = true
        state.error = null
      })
      .addCase(fetchCurrentUser.rejected, (state, action) => {
        state.loading = false
        // Only a rejected token signs the user out; a network blip must not.
        if (action.payload?.status === 401) {
          clearAuthToken()
          state.user = null
          state.token = null
          state.isAuthenticated = false
        }
      })
  },
})

function startLoading(state) {
  state.loading = true
  state.error = null
}

function applySession(state, action) {
  const { token, user } = action.payload
  setAuthToken(token)
  state.loading = false
  state.token = token
  state.user = user
  state.isAuthenticated = true
  state.error = null
}

function applyFailure(state, action) {
  state.loading = false
  state.isAuthenticated = false
  state.error = action.payload ?? 'Something went wrong. Please try again.'
}

export const { logout, clearAuthError } = authSlice.actions

export default authSlice.reducer
