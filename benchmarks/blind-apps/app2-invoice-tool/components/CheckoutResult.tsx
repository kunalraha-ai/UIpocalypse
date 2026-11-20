'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { Invoice } from '@/lib/types';

/**
 * Success page body: confirms the payment by calling /api/checkout/confirm
 * (the stand-in for Stripe's checkout.session.completed webhook) and shows
 * the result. Safe to call twice — the endpoint is idempotent.
 */
export default function CheckoutResult({
  invoiceId,
  sessionId,
}: {
  invoiceId?: string;
  sessionId?: string;
}) {
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [alreadyPaid, setAlreadyPaid] = useState(false);
  const [done, setDone] = useState(false);
  const requested = useRef(false);

  useEffect(() => {
    if (!invoiceId) {
      setDone(true);
      return;
    }
    if (requested.current) return;
    requested.current = true;

    (async () => {
      try {
        const res = await fetch('/api/checkout/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ invoiceId, sessionId }),
        });
        if (res.ok) {
          const data = (await res.json()) as { invoice: Invoice; alreadyPaid: boolean };
          setInvoice(data.invoice);
          setAlreadyPaid(data.alreadyPaid);
        }
      } catch {
        // Even if the confirm call fails, the payment page flow already
        // marked the invoice paid; still show the success screen.
      } finally {
        setDone(true);
      }
    })();
  }, [invoiceId, sessionId]);

  if (!done) {
    return (
      <>
        <div className="spinner" />
        <p className="loading-text">Confirming payment…</p>
      </>
    );
  }

  return (
    <div className="result-wrap">
      <div className="result-card">
        <div className="result-icon success">✓</div>
        <h1>Payment successful</h1>
        <p className="result-detail">
          {invoice
            ? `Invoice ${invoice.number} is marked as paid.`
            : 'Thanks for your payment.'}
        </p>
        <p>
          {alreadyPaid && invoice
            ? 'This invoice had already been paid — nothing was changed.'
            : 'Test mode: no real charge was made.'}
        </p>
        <div className="result-actions">
          {invoice && (
            <Link className="btn btn-primary" href={`/invoices/${invoice.id}`}>
              View invoice
            </Link>
          )}
          <Link className="btn btn-outline" href="/">
            Back to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
