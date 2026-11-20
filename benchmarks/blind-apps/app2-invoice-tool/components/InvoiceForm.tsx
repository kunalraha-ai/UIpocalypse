'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { Invoice } from '@/lib/types';
import { addDaysISO, computeTotals, formatMoney, todayISO, toNumber } from '@/lib/calc';

interface Row {
  key: string;
  description: string;
  quantity: string;
  unitPrice: string;
}

let rowCounter = 0;
function nextRowKey(): string {
  rowCounter += 1;
  return `row-${rowCounter}`;
}

function emptyRow(): Row {
  return { key: nextRowKey(), description: '', quantity: '1', unitPrice: '' };
}

export default function InvoiceForm({
  mode,
  invoiceId,
}: {
  mode: 'create' | 'edit';
  invoiceId?: string;
}) {
  const router = useRouter();

  const [loading, setLoading] = useState(mode === 'edit');
  const [clientName, setClientName] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [issueDate, setIssueDate] = useState(todayISO());
  const [dueDate, setDueDate] = useState(addDaysISO(todayISO(), 14));
  const [taxRate, setTaxRate] = useState('10'); // 10% default tax
  const [notes, setNotes] = useState('');
  const [rows, setRows] = useState<Row[]>([emptyRow()]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (mode !== 'edit' || !invoiceId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/invoices/${invoiceId}`, { cache: 'no-store' });
        if (!res.ok) throw new Error('not found');
        const data = (await res.json()) as { invoice: Invoice };
        if (cancelled) return;
        const invoice = data.invoice;
        setClientName(invoice.clientName);
        setClientEmail(invoice.clientEmail);
        setIssueDate(invoice.issueDate);
        setDueDate(invoice.dueDate);
        setTaxRate(String(invoice.taxRate));
        setNotes(invoice.notes);
        setRows(
          invoice.items.map((item) => ({
            key: nextRowKey(),
            description: item.description,
            quantity: String(item.quantity),
            unitPrice: String(item.unitPrice),
          })),
        );
      } catch {
        if (!cancelled) setError('Could not load this invoice — it may have been deleted.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, invoiceId]);

  const totals = useMemo(
    () =>
      computeTotals(
        rows.map((row) => ({
          id: row.key,
          description: row.description,
          quantity: toNumber(row.quantity),
          unitPrice: toNumber(row.unitPrice),
        })),
        toNumber(taxRate),
      ),
    [rows, taxRate],
  );

  const updateRow = (key: string, patch: Partial<Row>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  const removeRow = (key: string) =>
    setRows((current) => (current.length === 1 ? current : current.filter((row) => row.key !== key)));

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setError(null);

    const payload = {
      clientName: clientName.trim(),
      clientEmail: clientEmail.trim(),
      issueDate,
      dueDate,
      taxRate: toNumber(taxRate),
      notes,
      items: rows.map((row) => ({
        description: row.description.trim(),
        quantity: toNumber(row.quantity),
        unitPrice: toNumber(row.unitPrice),
      })),
    };

    setSaving(true);
    try {
      const res = await fetch(
        mode === 'create' ? '/api/invoices' : `/api/invoices/${invoiceId}`,
        {
          method: mode === 'create' ? 'POST' : 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? 'Something went wrong while saving.');
        return;
      }
      const { invoice } = data as { invoice: Invoice };
      router.push(`/invoices/${invoice.id}`);
    } catch {
      setError('Could not reach the server. Please try again.');
    } finally {
      setSaving(false);
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

  return (
    <>
      <Link
        href={mode === 'edit' && invoiceId ? `/invoices/${invoiceId}` : '/'}
        className="back-link"
      >
        ← Back
      </Link>
      <div className="page-head">
        <div>
          <h1 className="page-title">{mode === 'create' ? 'New invoice' : 'Edit invoice'}</h1>
          <p className="page-sub">
            Add line items — the running total and tax update as you type.
          </p>
        </div>
      </div>

      {error && <div className="form-error">{error}</div>}

      <form onSubmit={handleSubmit}>
        <div className="form-layout">
          <div className="form-layout-main">
            <div className="card card-pad">
              <div className="card-title">Client</div>
              <div className="form-grid">
                <div className="field">
                  <label className="label" htmlFor="clientName">
                    Client name
                  </label>
                  <input
                    id="clientName"
                    className="input"
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                    placeholder="Acme Studio"
                    required
                  />
                </div>
                <div className="field">
                  <label className="label" htmlFor="clientEmail">
                    Client email <span style={{ fontWeight: 400, color: 'var(--muted)' }}>(optional)</span>
                  </label>
                  <input
                    id="clientEmail"
                    className="input"
                    type="email"
                    value={clientEmail}
                    onChange={(e) => setClientEmail(e.target.value)}
                    placeholder="billing@acme.com"
                  />
                </div>
                <div className="field" style={{ gridColumn: '1 / -1' }}>
                  <label className="label" htmlFor="notes">
                    Notes <span style={{ fontWeight: 400, color: 'var(--muted)' }}>(optional)</span>
                  </label>
                  <textarea
                    id="notes"
                    className="input"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Payment terms, a thank-you note, anything the client should know…"
                  />
                </div>
              </div>
            </div>

            <div className="card card-pad">
              <div className="card-title">Line items</div>
              <div className="items-grid">
                <div className="items-head">Description</div>
                <div className="items-head items-head-right">Qty</div>
                <div className="items-head items-head-right">Unit price</div>
                <div className="items-head items-head-right items-head-total">Amount</div>
                <div />
              </div>
              {rows.map((row) => (
                <div key={row.key} className="items-grid item-row">
                  <input
                    className="input"
                    aria-label="Line item description"
                    value={row.description}
                    onChange={(e) => updateRow(row.key, { description: e.target.value })}
                    placeholder="Landing page build"
                  />
                  <input
                    className="input"
                    type="number"
                    aria-label="Quantity"
                    min="0"
                    step="1"
                    value={row.quantity}
                    onChange={(e) => updateRow(row.key, { quantity: e.target.value })}
                  />
                  <input
                    className="input"
                    type="number"
                    aria-label="Unit price"
                    min="0"
                    step="0.01"
                    value={row.unitPrice}
                    onChange={(e) => updateRow(row.key, { unitPrice: e.target.value })}
                    placeholder="0.00"
                  />
                  <div className="item-total item-total-cell">
                    {formatMoney(toNumber(row.quantity) * toNumber(row.unitPrice))}
                  </div>
                  <button
                    type="button"
                    className="remove-item"
                    onClick={() => removeRow(row.key)}
                    aria-label="Remove line item"
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="add-item"
                onClick={() => setRows((current) => [...current, emptyRow()])}
              >
                + Add line item
              </button>
            </div>
          </div>

          <div className="field-stack">
            <div className="card card-pad">
              <div className="card-title">Details</div>
              <div className="field-stack">
                <div className="field">
                  <label className="label" htmlFor="issueDate">
                    Issue date
                  </label>
                  <input
                    id="issueDate"
                    className="input"
                    type="date"
                    value={issueDate}
                    onChange={(e) => setIssueDate(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label className="label" htmlFor="dueDate">
                    Due date
                  </label>
                  <input
                    id="dueDate"
                    className="input"
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label className="label" htmlFor="taxRate">
                    Tax rate
                  </label>
                  <div className="input-suffix" data-suffix="%">
                    <input
                      id="taxRate"
                      className="input"
                      type="number"
                      min="0"
                      max="100"
                      step="0.5"
                      value={taxRate}
                      onChange={(e) => setTaxRate(e.target.value)}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="card card-pad">
              <div className="card-title">Summary</div>
              <div className="totals-box">
                <div className="totals-line">
                  <span>Subtotal</span>
                  <strong>{formatMoney(totals.subtotal)}</strong>
                </div>
                <div className="totals-line">
                  <span>Tax ({toNumber(taxRate)}%)</span>
                  <strong>{formatMoney(totals.taxAmount)}</strong>
                </div>
                <div className="totals-grand">
                  <span>Total</span>
                  <span className="amount">{formatMoney(totals.total)}</span>
                </div>
              </div>
              <button type="submit" className="btn btn-primary btn-block" disabled={saving}>
                {saving ? 'Saving…' : mode === 'create' ? 'Save invoice' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      </form>
    </>
  );
}
