import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Signup() {
  const { signup } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      await signup(email, password);
      navigate("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <div className="card auth-card">
        <div className="auth-brand">
          <span className="auth-brand__flame" aria-hidden="true">
            <svg viewBox="0 0 64 64" width="40" height="40">
              <defs>
                <linearGradient id="flame2" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#ffb347" />
                  <stop offset="1" stopColor="#ff5e3a" />
                </linearGradient>
              </defs>
              <path
                fill="url(#flame2)"
                d="M32 4c3 8-6 12-6 20 0 4 3 7 7 7 3 0 5-2 5-5 4 3 6 8 6 12 0 10-8 18-18 18S8 48 8 38C8 24 22 16 24 8c4 2 5 6 5 6 1-4 2-7 3-10z"
              />
            </svg>
          </span>
          <h1>Create your account</h1>
          <p className="auth-sub">Build habits. Keep the fire going.</p>
        </div>

        <form onSubmit={handleSubmit} noValidate>
          <div className="field">
            <label htmlFor="signup-email">Email</label>
            <input
              id="signup-email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="signup-password">Password</label>
            <input
              id="signup-password"
              type="password"
              autoComplete="new-password"
              placeholder="At least 6 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="signup-confirm">Confirm password</label>
            <input
              id="signup-confirm"
              type="password"
              autoComplete="new-password"
              placeholder="Repeat your password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>

          {error && <p className="form-error">{error}</p>}

          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
            {busy ? "Creating account…" : "Sign up"}
          </button>
        </form>

        <p className="auth-switch">
          Already have an account? <Link to="/login">Log in</Link>
        </p>
      </div>
    </main>
  );
}
