import { createAsyncThunk, createSlice } from '@reduxjs/toolkit'
import { authApi, clearAuthToken, getAuthToken, setAuthToken } from '../services/api'

const storedToken = getAuthToken()

const initialState = {
  user: null,
  token: storedToken,
  isAuthenticated: Boolean(storedToken),
  isAuthResolved: !storedToken,
  loading: false,
  error: null,
}

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
  state.isAuthResolved = true
  state.error = null
}

function applyFailure(state, action) {
  state.loading = false
  state.isAuthenticated = false
  state.error = action.payload ?? 'Something went wrong. Please try again.'
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
      state.isAuthResolved = true
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
      .addCase(fetchCurrentUser.pending, (state) => {
        startLoading(state)
        state.isAuthResolved = false
      })
      .addCase(fetchCurrentUser.fulfilled, (state, action) => {
        state.loading = false
        state.isAuthResolved = true
        state.user = action.payload.user
        state.isAuthenticated = true
        state.error = null
      })
      .addCase(fetchCurrentUser.rejected, (state, action) => {
        state.loading = false
        state.isAuthResolved = true
        if (action.payload?.status === 401) {
          clearAuthToken()
          state.user = null
          state.token = null
          state.isAuthenticated = false
        }
      })
  },
})

export const { logout, clearAuthError } = authSlice.actions

export default authSlice.reducer
