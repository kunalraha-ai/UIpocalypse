'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import type { Invoice } from '@/lib/types';
import { formatDate, formatMoney, invoiceTotal, isOverdue, lineTotal } from '@/lib/calc';
import StatusBadge from './StatusBadge';

interface SendResult {
  message: string;
  invoice: Invoice;
}

export default function InvoiceDetail({ invoiceId }: { invoiceId: string }) {
  const router = useRouter();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [sendResult, setSendResult] = useState<SendResult | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/invoices/${invoiceId}`, { cache: 'no-store' });
      if (res.status === 404) {
        setLoadError('Invoice not found — it may have been deleted.');
        return;
      }
      if (!res.ok) throw new Error('request failed');
      const data = (await res.json()) as { invoice: Invoice };
      setInvoice(data.invoice);
      setLoadError(null);
    } catch {
      setLoadError('Could not load this invoice.');
    } finally {
      setLoading(false);
    }
  }, [invoiceId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Simulated send: the API flips the invoice to "sent" and returns a
   * confirmation message; we show it in an email-preview modal. */
  async function sendInvoice() {
    if (!invoice) return;
    setBusy('send');
    setError(null);
    try {
      const res = await fetch(`/api/invoices/${invoice.id}/send`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? 'Could not send the invoice.');
        return;
      }
      setInvoice(data.invoice);
      setSendResult({ message: data.message as string, invoice: data.invoice as Invoice });
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(null);
    }
  }

  async function markPaid() {
    if (!invoice) return;
    setBusy('paid');
    setError(null);
    try {
      const res = await fetch(`/api/invoices/${invoice.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'paid' }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? 'Could not update the invoice.');
        return;
      }
      setInvoice(data.invoice);
      setNotice(`Invoice ${data.invoice.number} marked as paid. 🎉`);
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(null);
    }
  }

  async function startCheckout() {
    if (!invoice) return;
    setBusy('checkout');
    setError(null);
    try {
      const res = await fetch(`/api/invoices/${invoice.id}/checkout`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.url) {
        setError(data?.error ?? 'Could not start checkout.');
        return;
      }
      // Real Stripe test checkout, or the built-in simulator when only the
      // placeholder key is configured.
      window.location.href = data.url as string;
    } catch {
      setError('Could not reach the server.');
      setBusy(null);
    }
  }

  async function removeInvoice() {
    if (!invoice) return;
    if (!window.confirm(`Delete invoice ${invoice.number}? This cannot be undone.`)) return;
    setBusy('delete');
    setError(null);
    try {
      const res = await fetch(`/api/invoices/${invoice.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        setError(data?.error ?? 'Could not delete the invoice.');
        return;
      }
      router.push('/');
    } catch {
      setError('Could not reach the server.');
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <>
        <div className="spinner" />
        <p className="loading-text">Loading invoice…</p>
      </>
    );
  }

  if (loadError || !invoice) {
    return (
      <>
        <Link href="/" className="back-link">
          ← Back to dashboard
        </Link>
        <div className="card card-pad">
          <p>{loadError ?? 'Invoice not found.'}</p>
        </div>
      </>
    );
  }

  const totals = invoiceTotal(invoice);

  return (
    <>
      <Link href="/" className="back-link">
        ← Back to dashboard
      </Link>

      <div className="page-head">
        <div>
          <h1 className="page-title">Invoice {invoice.number}</h1>
          <p className="page-sub">
            {invoice.clientName}
            {invoice.clientEmail ? ` · ${invoice.clientEmail}` : ''}
          </p>
        </div>
        <StatusBadge invoice={invoice} />
      </div>

      {notice && (
        <div className="banner banner-success">
          <span>{notice}</span>
          <button className="banner-dismiss" onClick={() => setNotice(null)} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}
      {error && <div className="form-error">{error}</div>}

      <div className="card card-pad">
        <div className="doc-meta-grid">
          <div>
            <div className="doc-meta-label">Issued</div>
            <div className="doc-meta-value">{formatDate(invoice.issueDate)}</div>
          </div>
          <div>
            <div className="doc-meta-label">Due</div>
            <div className="doc-meta-value">
              {formatDate(invoice.dueDate)}
              {isOverdue(invoice) && (
                <span className="row-overdue"> · overdue</span>
              )}
            </div>
          </div>
          <div>
            <div className="doc-meta-label">Sent</div>
            <div className="doc-meta-value">
              {invoice.sentAt ? formatDate(invoice.sentAt) : '—'}
            </div>
          </div>
          <div>
            <div className="doc-meta-label">Paid</div>
            <div className="doc-meta-value">
              {invoice.paidAt ? formatDate(invoice.paidAt) : '—'}
            </div>
          </div>
        </div>

        <div style={{ overflowX: 'auto', marginTop: 18 }}>
          <table className="table" style={{ minWidth: 560 }}>
            <thead>
              <tr>
                <th>Description</th>
                <th style={{ textAlign: 'right' }}>Qty</th>
                <th style={{ textAlign: 'right' }}>Unit price</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {invoice.items.map((item) => (
                <tr key={item.id}>
                  <td>{item.description}</td>
                  <td style={{ textAlign: 'right' }}>{item.quantity}</td>
                  <td style={{ textAlign: 'right' }}>{formatMoney(item.unitPrice)}</td>
                  <td className="amount">{formatMoney(lineTotal(item))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="totals-box" style={{ marginLeft: 'auto', width: 280, marginTop: 18 }}>
          <div className="totals-line">
            <span>Subtotal</span>
            <strong>{formatMoney(totals.subtotal)}</strong>
          </div>
          <div className="totals-line">
            <span>
              Tax ({invoice.taxRate}%)
            </span>
            <strong>{formatMoney(totals.taxAmount)}</strong>
          </div>
          <div className="totals-grand">
            <span>Total</span>
            <span className="amount">{formatMoney(totals.total)}</span>
          </div>
        </div>

        {invoice.notes && <div className="doc-notes">{invoice.notes}</div>}

        <div className="doc-actions">
          {invoice.status === 'draft' && (
            <button className="btn btn-primary" onClick={sendInvoice} disabled={busy !== null}>
              {busy === 'send' ? 'Sending…' : 'Send invoice'}
            </button>
          )}
          {invoice.status === 'sent' && (
            <>
              <button className="btn btn-success" onClick={markPaid} disabled={busy !== null}>
                {busy === 'paid' ? 'Updating…' : 'Mark as paid'}
              </button>
              <button className="btn btn-outline" onClick={sendInvoice} disabled={busy !== null}>
                {busy === 'send' ? 'Sending…' : 'Send reminder'}
              </button>
            </>
          )}
          {invoice.status !== 'paid' && (
            <button className="btn btn-outline" onClick={startCheckout} disabled={busy !== null}>
              {busy === 'checkout' ? 'Opening checkout…' : 'Collect payment (Stripe test)'}
            </button>
          )}
          <Link href={`/invoices/${invoice.id}/edit`} className="btn btn-ghost">
            Edit
          </Link>
          <button className="btn btn-danger-ghost" onClick={removeInvoice} disabled={busy !== null}>
            Delete
          </button>
          {invoice.status === 'paid' && (
            <span className="paid-stamp">
              ✓ Paid{invoice.paidAt ? ` — ${formatDate(invoice.paidAt)}` : ''}
            </span>
          )}
        </div>
      </div>

      {sendResult && (
        <div className="modal-backdrop" onClick={() => setSendResult(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-check">✓</div>
            <h2>Invoice sent</h2>
            <p className="modal-sub">{sendResult.message}</p>
            <div className="email-preview">
              <div className="email-header">
                <div>
                  <strong>To:</strong> {sendResult.invoice.clientEmail || '(no client email on file)'}
                </div>
                <div>
                  <strong>Subject:</strong> Invoice {sendResult.invoice.number} — due{' '}
                  {formatDate(sendResult.invoice.dueDate)}
                </div>
              </div>
              <div className="email-body">
                <p>Hi {sendResult.invoice.clientName},</p>
                <p>
                  Invoice <strong>{sendResult.invoice.number}</strong> for{' '}
                  <strong>{formatMoney(invoiceTotal(sendResult.invoice).total)}</strong> is ready and
                  due on <strong>{formatDate(sendResult.invoice.dueDate)}</strong>.
                </p>
                <p>You can pay online with a card using the button below.</p>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => {
                    setSendResult(null);
                    void startCheckout();
                  }}
                >
                  Pay invoice online
                </button>
                <p className="email-signature">— Sent via Freelance Invoices (simulated email)</p>
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn btn-outline" onClick={() => setSendResult(null)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
