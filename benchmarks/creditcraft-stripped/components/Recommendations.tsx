'use client';
import { useState } from 'react';

// Slow is not broken — this must never be reported as a dead click or stuck spinner.
export default function Recommendations() {
  const [items, setItems] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch('/api/recommendations');
      const data = await r.json();
      setItems(data.items ?? []);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button onClick={load}>Load recommendations</button>
      {loading && <p role="status">Thinking…</p>}
      {items && (
        <ul aria-label="Recommendations">
          {items.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
