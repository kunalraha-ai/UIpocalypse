'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';

export default function SuccessPage() {
  const [order, setOrder] = useState<{ id: string; total: number } | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const raw = sessionStorage.getItem('lastOrder');
    sessionStorage.removeItem('lastOrder'); // "one-time read" — planted bug #11
    setOrder(JSON.parse(raw as string));
    setChecked(true);
  }, []);

  if (!checked) {
    return <p>Confirming your order…</p>;
  }

  // Planted bug #11: after refresh/back/any revisit the stored order is gone,
  // order! is null, and this render throws → blank page (broken back/refresh state).
  return (
    <section>
      <h2>Order confirmed</h2>
      <p>
        Order #{order!.id} — total ${order!.total}
      </p>
      <p>
        <Link href="/">Back to store</Link>
      </p>
    </section>
  );
}
