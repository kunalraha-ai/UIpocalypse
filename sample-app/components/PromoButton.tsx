'use client';
import { useState } from 'react';

export default function PromoButton() {
  const [loading, setLoading] = useState(false);

  async function seePromo() {
    setLoading(true);
    try {
      const r = await fetch('/api/promo'); // Planted bug #3: this route does not exist → 404
      const data = await r.json().catch(() => ({}));
      void data;
    } catch {
      // silent 404 — nothing the user can see
    } finally {
      setLoading(false);
    }
  }

  return (
    <p>
      <button onClick={seePromo} disabled={loading}>
        {loading ? 'Checking…' : "See today's promo"}
      </button>
    </p>
  );
}
