'use client';
import { useEffect, useState } from 'react';
import Spinner from './Spinner';

export default function OrdersList() {
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<{ id: string; total: number }[]>([]);

  useEffect(() => {
    fetch('/api/orders')
      .then((r) => r.json())
      .then((data) => {
        setOrders(data.orders ?? []);
        setLoading(false);
      })
      .catch(() => {
      });
  }, []);

  return (
    <section>
      <h2>Your orders</h2>
      {loading ? (
        <Spinner label="Loading your orders…" />
      ) : (
        <ul>
          {orders.map((o) => (
            <li key={o.id}>
              Order {o.id} — ${o.total}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
