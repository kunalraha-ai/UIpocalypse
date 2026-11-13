import React, { useState } from 'react';
import { Routes, Route, NavLink, useParams } from 'react-router-dom';
import Home from './pages/Home.jsx';
import About from './pages/About.jsx';
import Settings from './pages/Settings.jsx';
import Item from './pages/Item.jsx';

// Deliberately "vibecoded": divs as buttons, emoji everywhere, inline styles.
const btn = {
  padding: '6px 12px',
  background: 'linear-gradient(45deg, #ff6ec7, #7873f5)',
  color: '#fff',
  borderRadius: '20px',
  cursor: 'pointer',
  display: 'inline-block',
  margin: '4px',
  fontWeight: 700,
};

export default function App() {
  return (
    <div style={{ fontFamily: 'Comic Sans MS, cursive', maxWidth: 720, margin: '0 auto', padding: 16 }}>
      <h1 style={{ textAlign: 'center', fontSize: 28 }}>🛒 Messy Mart 🛒</h1>
      <nav aria-label="Main" style={{ textAlign: 'center' }}>
        <NavLink to="/" style={{ margin: 8 }}>🏠 Store</NavLink>
        <NavLink to="/about" style={{ margin: 8 }}>❓ About</NavLink>
        <NavLink to="/settings" style={{ margin: 8 }}>⚙️ Settings</NavLink>
      </nav>
      <div aria-hidden="true" style={{ textAlign: 'center', opacity: 0.4 }}>
        ✨ super decorative ✨
      </div>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/item/:id" element={<Item />} />
        <Route path="/about" element={<About />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
      <footer style={{ textAlign: 'center', marginTop: 40, opacity: 0.5 }}>
        built in 5 minutes by a vibe ✌️
      </footer>
    </div>
  );
}

export { btn };
