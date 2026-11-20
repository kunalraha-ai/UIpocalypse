import { useState } from 'react'
import { useAuth } from '../context/AuthContext'

const inputClass =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200'

export default function AuthScreen() {
  const { signIn, signUp } = useAuth()
  const [mode, setMode] = useState('signin') // 'signin' | 'signup'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [busy, setBusy] = useState(false)

  const isSignUp = mode === 'signup'

  function switchMode(next) {
    setMode(next)
    setError(null)
    setNotice(null)
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setError(null)
    setNotice(null)

    const trimmedEmail = email.trim()
    if (!trimmedEmail || !password) {
      setError('Please enter your email and password.')
      return
    }
    if (isSignUp && password.length < 6) {
      setError('Password must be at least 6 characters long.')
      return
    }

    setBusy(true)
    try {
      if (isSignUp) {
        const { data, error: signUpError } = await signUp(trimmedEmail, password)
        if (signUpError) throw signUpError
        // When email confirmation is enabled (e.g. on hosted projects) there
        // is no session yet, so ask the user to confirm before signing in.
        if (!data.session) {
          setNotice('Account created. Check your inbox to confirm your email, then sign in.')
          setMode('signin')
        }
      } else {
        const { error: signInError } = await signIn(trimmedEmail, password)
        if (signInError) throw signInError
      }
    } catch (err) {
      setError(err?.message ?? 'Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="rounded-2xl bg-white p-8 shadow-xl ring-1 ring-slate-200">
          <div className="mb-6 text-center">
            <div className="text-4xl" aria-hidden="true">📝</div>
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-900">Notes</h1>
            <p className="mt-1 text-sm text-slate-500">
              {isSignUp ? 'Create an account to start taking notes.' : 'Sign in to access your notes.'}
            </p>
          </div>

          <div className="mb-6 grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => switchMode('signin')}
              aria-pressed={mode === 'signin'}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                mode === 'signin' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Sign in
            </button>
            <button
              type="button"
              onClick={() => switchMode('signup')}
              aria-pressed={mode === 'signup'}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                mode === 'signup' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Sign up
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="mb-1 block text-sm font-medium text-slate-700">
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                className={inputClass}
              />
            </div>

            <div>
              <label htmlFor="password" className="mb-1 block text-sm font-medium text-slate-700">
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete={isSignUp ? 'new-password' : 'current-password'}
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Your password"
                  className={`${inputClass} pr-16`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  className="absolute inset-y-0 right-2 px-2 text-xs font-medium text-slate-500 hover:text-slate-700"
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
              {isSignUp && <p className="mt-1 text-xs text-slate-400">At least 6 characters.</p>}
            </div>

            {error && (
              <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}
            {notice && (
              <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? 'Please wait…' : isSignUp ? 'Create account' : 'Sign in'}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-slate-400">Your notes are private and stored in Supabase.</p>
      </div>
    </div>
  )
}
