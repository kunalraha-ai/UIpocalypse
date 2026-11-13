'use client';

// Fixture: async GET with no error handling. Fires the error-handling rule only
// (GET is not a submit, so the submit-guard rule must not fire).
export default function BadAsync() {
  async function load() {
    const r = await fetch('/api/exists');
    void r;
  }
  return <button onClick={load}>Load data</button>;
}
