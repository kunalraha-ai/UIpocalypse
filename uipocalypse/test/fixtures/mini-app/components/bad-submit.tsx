'use client';

// Fixture: unguarded POST submit with no error handling.
export default function BadSubmit() {
  async function submit() {
    const r = await fetch('/api/exists', { method: 'POST' });
    void r;
  }
  return <button onClick={submit}>Submit order</button>;
}
