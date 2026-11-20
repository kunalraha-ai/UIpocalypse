'use client';
import { useState } from 'react';

// Toggling it only mutates the DOM — a correct dead-click detector must not flag it.
export default function Accordion({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button aria-expanded={open} onClick={() => setOpen(!open)}>
        {title}
      </button>
      {open && <div>{children}</div>}
    </div>
  );
}
