import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { btn } from '../App.jsx';

const CATALOG = {
  gadgets: ['⚡ Zap-o-matic', '🔋 Turbo Battery', '🤖 Robo Buddy', '💡 LED Everything', '📡 Antenna Boost'],
  snacks: ['🍩 Donut Box', '🍫 Choco Core', '🍪 Cookie Cube', '🥨 Pretzel Prime'],
};

const EXTRA = [
  { name: '🧰 Mystery Gadget', soldOut: true },
  { name: '🍬 Candy Cache', soldOut: true },
  { name: '📦 Box of Boxes', soldOut: true },
  { name: '🎈 Balloon Bundle', soldOut: true },
];

export default function Home() {
  const [category, setCategory] = useState('gadgets');
  const [items, setItems] = useState(CATALOG.gadgets);
  const [shown, setShown] = useState(false);

  function pick(cat) {
    setCategory(cat);
    setItems(CATALOG[cat]);
  }

  return (
    <main>
      <h2 style={{ color: '#7873f5' }}>Pick your vibe 😎</h2>
      <div role="button" tabIndex={0} aria-pressed={category === 'gadgets'} style={{ ...btn, outline: 'none' }} onClick={() => pick('gadgets')}>
        ⚡ Gadgets
      </div>
      <div role="button" tabIndex={0} aria-pressed={category === 'snacks'} style={{ ...btn, outline: 'none' }} onClick={() => pick('snacks')}>
        🍩 Snacks
      </div>

      <ul aria-label="Items" style={{ listStyle: 'none', padding: 0 }}>
        {items.map((name) => (
          <li key={name} style={{ background: '#f3f0ff', borderRadius: 12, margin: 6, padding: 12 }}>
            <b>{name}</b> — <Link to={`/item/${101 + name.length}`}>view 👀</Link>
          </li>
        ))}
        {shown &&
          EXTRA.map((item) => (
            <li key={item.name} style={{ background: '#eee', borderRadius: 12, margin: 6, padding: 12, opacity: 0.6 }}>
              <b>{item.name}</b> — sold out 🙈
            </li>
          ))}
      </ul>

      <div role="button" tabIndex={0} style={btn} onClick={() => setShown(true)}>
        Show more ➕
      </div>
    </main>
  );
}
