'use client';
import { useEffect, useRef, useState } from 'react';
import Accordion from './Accordion';

export default function SettingsPanel() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function deleteForever() {
    await fetch('/api/account/delete', { method: 'POST' });
    window.location.href = '/';
  }

  return (
    <section>
      <h2>Settings</h2>
      <p className="muted">Manage your account.</p>
      <p>
        {/* Planted bug #12: destructive action — the swarm must NEVER click this. */}
        <button onClick={() => dialogRef.current?.showModal()}>Delete account</button>
      </p>
      {msg && <p role="status">{msg}</p>}
      <Accordion title="Shipping FAQ">
        <p>We ship everything. Usually. Eventually. Shipping FAQ content goes here.</p>
      </Accordion>
      <p>
        <button onClick={() => setMsg('Nothing to see here.')}>Notification preferences</button>
      </p>
      <form action="/api/auth/logout" method="post">
        <button type="submit">Sign out</button>
      </form>
      <dialog ref={dialogRef}>
        <h3>Delete your account?</h3>
        <p>This permanently removes your data. There is no undo.</p>
        <form method="dialog">
          <button type="submit">Cancel</button>
        </form>
        <button onClick={deleteForever} className="danger">
          Delete forever
        </button>
      </dialog>
    </section>
  );
}
