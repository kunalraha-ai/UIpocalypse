'use client';
import { useState } from 'react';

const PACKS = [
  { id: 'p5', label: '$5 — 500 credits' },
  { id: 'p10', label: '$10 — 1100 credits' },
  { id: 'p20', label: '$20 — 2400 credits' },
];

export default function BuyCredits({ initialCredits }: { initialCredits: number }) {
  const [credits, setCredits] = useState(initialCredits);
  const [msg, setMsg] = useState<string | null>(null);
  const [pack, setPack] = useState('p5');

  async function buy() {
    // and the server has no idempotency, so credits are charged twice.
    const r = await fetch('/api/credits/buy', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ packId: pack }),
    });
    const data = await r.json().catch(() => ({}));
    if (r.ok) {
      setCredits(data.balance);
      setMsg('Credits added!');
    } else {
      setMsg(data.error ?? 'Purchase failed');
    }
  }

  return (
    <section>
      <h2>Buy credits</h2>
      <p>
        Current balance: <strong>{credits}</strong> credits
      </p>
      <fieldset>
        <legend>Pick a pack</legend>
        {PACKS.map((p) => (
          <div key={p.id}>
            <input
              type="radio"
              id={p.id}
              name="pack"
              value={p.id}
              checked={pack === p.id}
              onChange={() => setPack(p.id)}
            />
            <label htmlFor={p.id}>{p.label}</label>
          </div>
        ))}
      </fieldset>
      <button onClick={buy}>Buy credits</button>
      {msg && <p role="status">{msg}</p>}
    </section>
  );
}
