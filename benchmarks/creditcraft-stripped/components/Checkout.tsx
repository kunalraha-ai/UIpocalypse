'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function Checkout() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [total, setTotal] = useState(42);

  async function redeem() {
    setMsg(null);
    const r = await fetch('/api/coupon/redeem', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    const data = await r.json().catch(() => ({}));
    if (r.ok) {
      setTotal((t) => t - (data.discount ?? 0));
      setMsg(`Coupon applied: −$${data.discount}`);
    } else {
      setMsg(data.error ?? 'Could not redeem coupon');
    }
  }

  async function placeOrder() {
    const r = await fetch('/api/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ total }),
    });
    const data = await r.json().catch(() => ({}));
    if (r.ok) {
      sessionStorage.setItem('lastOrder', JSON.stringify({ id: data.orderId, total: data.total }));
      router.push('/checkout/success');
    }
  }

  return (
    <section>
      <h2>Checkout</h2>
      <p>
        Order total: <strong>${total}</strong>
      </p>
      <label>
        Coupon code
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="WELCOME10" />
      </label>
      <button onClick={redeem}>Redeem coupon</button>
      {msg && <p role="status">{msg}</p>}
      <p>
        <button onClick={placeOrder}>Place order</button>
      </p>
    </section>
  );
}
