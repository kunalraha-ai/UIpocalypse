'use client';
import { useState } from 'react';
import NameTag from './NameTag';

export default function ProfileForm({ initialName, credits }: { initialName: string; credits: number }) {
  const [name, setName] = useState(initialName);

  return (
    <section>
      <h2>Profile</h2>
      <p>
        <NameTag name={name} />
      </p>
      <p>
        Balance: {credits} credits
      </p>
      <label>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      {/* Planted bug #1: empty onClick — the button does nothing (dead click). */}
      <button onClick={() => {}}>Save profile</button>
    </section>
  );
}
