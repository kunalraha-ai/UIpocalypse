import React from 'react';
import { useParams, Link } from 'react-router-dom';
import { btn } from '../App.jsx';

export default function Item() {
  const { id } = useParams();
  return (
    <main>
      <h2>📦 Item #{id}</h2>
      <p style={{ fontSize: 20 }}>
        Price: ${(Number(id) % 97) + 3}.99 — it is very good. Buy now! 🎉
      </p>
      <div role="button" tabIndex={0} style={btn} onClick={() => alert('nope 😅')}>
        Buy it now 🎉
      </div>
      <p>
        <Link to="/">← back to the pile</Link>
      </p>
    </main>
  );
}
