import { Loader2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { clearAuthError, loginUser, registerUser } from '../../features/authSlice'
import { closeAuthModal, setAuthModalMode, showToast } from '../../features/uiSlice'
import Logo from '../Logo/Logo'
import './AuthModal.css'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MIN_PASSWORD_LENGTH = 6

const EMPTY_FORM = { name: '', email: '', password: '', confirm: '' }

export default function AuthModal() {
  const dispatch = useDispatch()
  const { isOpen, mode, message } = useSelector((state) => state.ui.authModal)

  if (!isOpen) return null

  const isSignUp = mode === 'signup'

  return (
    <div className="auth-overlay" role="dialog" aria-modal="true" aria-label="Authentication">
      <div className="auth-card">
        <button
          type="button"
          className="auth-close"
          title="Close"
          aria-label="Close"
          onClick={() => dispatch(closeAuthModal())}
        >
          <X size={16} />
        </button>

        <div className="auth-logo">
          <Logo size={52} />
        </div>

        <h2 className="auth-title">{isSignUp ? 'Create your account' : 'Welcome back'}</h2>
        <p className="auth-subtitle">
          {isSignUp
            ? 'Sign up to import projects and use the cloud workspace.'
            : 'Sign in to access your cloud projects and terminal.'}
        </p>

        {message && <div className="auth-message">{message}</div>}

        <div className="auth-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={!isSignUp}
            className={`auth-tab ${!isSignUp ? 'is-active' : ''}`}
            onClick={() => dispatch(setAuthModalMode('signin'))}
          >
            Sign In
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={isSignUp}
            className={`auth-tab ${isSignUp ? 'is-active' : ''}`}
            onClick={() => dispatch(setAuthModalMode('signup'))}
          >
            Sign Up
          </button>
        </div>

        <AuthForm key={mode} mode={mode} />

        <p className="auth-switch">
          {isSignUp ? 'Already have an account?' : "Don't have an account?"}
          <button
            type="button"
            className="auth-switch-link"
            onClick={() => dispatch(setAuthModalMode(isSignUp ? 'signin' : 'signup'))}
          >
            {isSignUp ? 'Sign In' : 'Sign Up'}
          </button>
        </p>
      </div>
    </div>
  )
}

function AuthForm({ mode }) {
  const dispatch = useDispatch()
  const { loading, error: apiError } = useSelector((state) => state.auth)
  const isSignUp = mode === 'signup'

  const [form, setForm] = useState(EMPTY_FORM)
  const [fieldErrors, setFieldErrors] = useState({})

  useEffect(() => {
    dispatch(clearAuthError())
  }, [dispatch])

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  function validate() {
    const next = {}
    if (isSignUp && !form.name.trim()) next.name = 'Please enter your name.'
    if (!EMAIL_PATTERN.test(form.email.trim())) next.email = 'Please enter a valid email address.'
    if (form.password.length < MIN_PASSWORD_LENGTH) {
      next.password = `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
    }
    if (isSignUp && form.password !== form.confirm) {
      next.confirm = 'Passwords do not match.'
    }
    setFieldErrors(next)
    return Object.keys(next).length === 0
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (loading || !validate()) return

    try {
      if (isSignUp) {
        const name = form.name.trim()
        await dispatch(
          registerUser({ name, email: form.email.trim(), password: form.password }),
        ).unwrap()
        dispatch(showToast({ message: `Welcome, ${name}!`, type: 'success' }))
      } else {
        const result = await dispatch(
          loginUser({ email: form.email.trim(), password: form.password }),
        ).unwrap()
        dispatch(showToast({ message: `Welcome back, ${result.user.name}!`, type: 'success' }))
      }
      dispatch(closeAuthModal())
    } catch {
      return
    }
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit} noValidate>
      {isSignUp && (
        <Field
          label="Name"
          placeholder="Enter your full name"
          value={form.name}
          error={fieldErrors.name}
          autoComplete="name"
          onChange={(value) => update('name', value)}
        />
      )}

      <Field
        label="Email"
        type="email"
        placeholder="you@example.com"
        value={form.email}
        error={fieldErrors.email}
        autoComplete="email"
        onChange={(value) => update('email', value)}
      />

      <Field
        label="Password"
        type="password"
        placeholder="Enter a strong password"
        value={form.password}
        error={fieldErrors.password}
        autoComplete={isSignUp ? 'new-password' : 'current-password'}
        onChange={(value) => update('password', value)}
      />

      {isSignUp && (
        <Field
          label="Confirm password"
          type="password"
          placeholder="Re-enter your password"
          value={form.confirm}
          error={fieldErrors.confirm}
          autoComplete="new-password"
          onChange={(value) => update('confirm', value)}
        />
      )}

      {apiError && <div className="auth-error">{apiError}</div>}

      <button type="submit" className="auth-submit" disabled={loading}>
        {loading && <Loader2 size={16} className="spin" />}
        <span>{isSignUp ? 'Create account' : 'Sign in'}</span>
      </button>
    </form>
  )
}

function Field({ label, placeholder, value, onChange, error, type = 'text', autoComplete }) {
  return (
    <label className="auth-field">
      <span className="auth-field-label">{label}</span>
      <input
        className={`auth-input ${error ? 'is-invalid' : ''}`}
        type={type}
        placeholder={placeholder}
        value={value}
        autoComplete={autoComplete}
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
      />
      {error && <span className="auth-field-error">{error}</span>}
    </label>
  )
}
