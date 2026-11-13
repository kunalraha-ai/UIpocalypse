'use client';
import { useState } from 'react';

// Fixture: guarded POST submit — fires nothing.
export default function GoodSubmit() {
  const [pending, setPending] = useState(false);
  async function submit() {
    setPending(true);
    try {
      await fetch('/api/exists', { method: 'POST' });
    } catch {
      // handled
    } finally {
      setPending(false);
    }
  }
  return (
    <button onClick={submit} disabled={pending}>
      Submit order
    </button>
  );
}
