import React, { useRef, useState } from 'react';
import { btn } from '../App.jsx';

export default function Settings() {
  const dialogRef = useRef(null);
  const [user, setUser] = useState('Alice the Tester 🧪');
  const [reloading, setReloading] = useState(false);

  function reload() {
    setReloading(true);
    setTimeout(() => setReloading(false), 700); // fake slow request
  }

  return (
    <main>
      <h2>⚙️ Settings</h2>
      <p>
        Hello, <b>{user}</b>
      </p>
      <div role="button" tabIndex={0} style={btn} onClick={() => setUser('Alice the Tester 🧪')}>
        👤 Alice
      </div>
      <div role="button" tabIndex={0} style={btn} onClick={() => setUser('Bob the Breaker 💥')}>
        👤 Bob
      </div>
      <div role="button" tabIndex={0} style={btn} onClick={reload}>
        🔄 Reload preferences
      </div>
      {reloading && <div role="progressbar" aria-label="Reloading your stuff" style={{ margin: 12 }}>⏳ spinning forever…</div>}
      <div>
        <div role="button" tabIndex={0} style={{ ...btn, background: '#e05555' }} onClick={() => dialogRef.current.showModal()}>
          💣 Delete everything
        </div>
      </div>
      <dialog ref={dialogRef}>
        <h3>Delete everything?? 😱</h3>
        <p>There is no undo. Obviously.</p>
        <form method="dialog">
          <button>Cancel 😬</button>
        </form>
        <button className="danger">Yes, really delete 💀</button>
      </dialog>
    </main>
  );
}
