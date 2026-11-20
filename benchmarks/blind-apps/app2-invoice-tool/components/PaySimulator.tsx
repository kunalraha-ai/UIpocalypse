'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { Invoice } from '@/lib/types';
import { formatDate, formatMoney, invoiceTotal } from '@/lib/calc';

/**
 * Built-in Stripe Checkout simulator (test mode). Used when only the
 * placeholder `sk_test_…` key is configured and the real Stripe API can't be
 * reached — mirrors the look of Stripe's hosted checkout page.
 */
export default function PaySimulator({ invoiceId }: { invoiceId: string }) {
  const router = useRouter();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/invoices/${invoiceId}`, { cache: 'no-store' });
        if (!res.ok) throw new Error('not found');
        const data = (await res.json()) as { invoice: Invoice };
        if (!cancelled) setInvoice(data.invoice);
      } catch {
        if (!cancelled) setLoadError('Could not load this invoice.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [invoiceId]);

  async function pay() {
    setPaying(true);
    setPayError(null);
    try {
      const res = await fetch('/api/checkout/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId, simulated: true }),
      });
      if (!res.ok) {
        const data = await res.json();
        setPayError(data?.error ?? 'Payment failed.');
        return;
      }
      router.push(`/checkout/success?invoice_id=${invoiceId}&simulated=1`);
    } catch {
      setPayError('Could not reach the server.');
    } finally {
      setPaying(false);
    }
  }

  if (loading) {
    return (
      <>
        <div className="spinner" />
        <p className="loading-text">Loading checkout…</p>
      </>
    );
  }

  if (loadError || !invoice) {
    return (
      <div className="result-wrap">
        <div className="result-card">
          <div className="result-icon cancel">✕</div>
          <h1>Checkout unavailable</h1>
          <p>{loadError ?? 'Invoice not found.'}</p>
          <div className="result-actions">
            <Link className="btn btn-outline" href="/">
              Back to dashboard
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const total = invoiceTotal(invoice).total;

  return (
    <div className="pay-page">
      <span className="test-pill">Test mode</span>
      <div className="pay-card">
        <div className="pay-merchant">
          <span className="brand-mark" aria-hidden="true">
            $
          </span>
          Freelance Invoices
        </div>
        <div className="pay-amount">{formatMoney(total)}</div>
        <p className="pay-description">
          Invoice {invoice.number} · {invoice.clientName} · due {formatDate(invoice.dueDate)}
        </p>
        <hr className="pay-divider" />

        {invoice.status === 'paid' ? (
          <>
            <p className="pay-note" style={{ fontSize: 14 }}>
              This invoice has already been paid — nothing to collect.
            </p>
            <Link href={`/invoices/${invoiceId}`} className="btn btn-outline btn-block">
              Back to invoice
            </Link>
          </>
        ) : (
          <div className="pay-fields">
            <div className="field">
              <label className="label" htmlFor="pay-email">
                Email
              </label>
              <input
                id="pay-email"
                className="input"
                type="email"
                defaultValue={invoice.clientEmail}
                placeholder="client@example.com"
              />
            </div>
            <div className="field">
              <label className="label" htmlFor="pay-card">
                Card number
              </label>
              <input
                id="pay-card"
                className="input"
                defaultValue="4242 4242 4242 4242"
                inputMode="numeric"
              />
            </div>
            <div className="pay-row-2">
              <div className="field">
                <label className="label" htmlFor="pay-exp">
                  Expiry
                </label>
                <input id="pay-exp" className="input" defaultValue="12 / 34" />
              </div>
              <div className="field">
                <label className="label" htmlFor="pay-cvc">
                  CVC
                </label>
                <input id="pay-cvc" className="input" defaultValue="123" />
              </div>
            </div>
            {payError && <div className="form-error" style={{ margin: 0 }}>{payError}</div>}
            <button className="pay-btn" onClick={pay} disabled={paying}>
              {paying ? 'Processing…' : `Pay ${formatMoney(total)}`}
            </button>
          </div>
        )}

        <p className="pay-note">
          Simulated Stripe Checkout · test mode — no real charge is ever made.
        </p>
        <Link className="pay-cancel" href={`/invoices/${invoiceId}`}>
          Cancel and return to invoice
        </Link>
      </div>
    </div>
  );
}
