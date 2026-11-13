'use client';
import { useState } from 'react';

export default function SearchBox() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<string[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
    const data = await r.json().catch(() => ({}));
    if (r.ok) {
      setResults(data.results ?? []);
    } else {
      setResults([]);
      setMsg('Search failed');
    }
  }

  return (
    <div>
      <form onSubmit={search}>
        <label>
          Search the store
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. lamp" />
        </label>
        <button type="submit">Search</button>
      </form>
      {msg && <p role="status">{msg}</p>}
      {results && (
        <ul aria-label="Search results">
          {results.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
