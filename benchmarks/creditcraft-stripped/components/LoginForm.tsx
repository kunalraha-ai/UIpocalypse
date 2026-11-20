'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

const TEST_USERS = [
  { label: 'Sign in as Alice', email: 'alice@example.com', password: 'secret123' },
  { label: 'Sign in as Bob', email: 'bob@example.com', password: 'secret123' },
];

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function login(payload: { email: string; password: string }) {
    setError(null);
    const r = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await r.json().catch(() => ({}));
    if (r.ok) {
      router.push('/');
      router.refresh();
    } else {
      setError(data.error ?? 'Login failed');
    }
  }

  return (
    <section>
      <h2>Sign in</h2>
      {TEST_USERS.map((u) => (
        <p key={u.label}>
          <button onClick={() => login(u)}>{u.label}</button>
        </p>
      ))}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          login({ email, password });
        }}
      >
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <button type="submit">Sign in</button>
      </form>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
