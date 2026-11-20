'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { Invoice } from '@/lib/types';
import { addDaysISO, computeTotals, formatDate, formatMoney, todayISO } from '@/lib/calc';
import StatusBadge from './StatusBadge';

interface SampleSeed {
  payload: Record<string, unknown>;
  status: 'sent' | 'paid';
}

const SAMPLES: SampleSeed[] = [
  {
    payload: {
      clientName: 'Acme Studio',
      clientEmail: 'billing@acme.example',
      issueDate: addDaysISO(todayISO(), -12),
      dueDate: addDaysISO(todayISO(), -2),
      taxRate: 10,
      notes: 'Logo work per the statement of work — payment within 14 days.',
      items: [
        { description: 'Logo design (2 concepts + revisions)', quantity: 1, unitPrice: 1200 },
        { description: 'Brand style guide', quantity: 1, unitPrice: 800 },
      ],
    },
    status: 'sent',
  },
  {
    payload: {
      clientName: 'Brightside Café',
      clientEmail: 'hello@brightside.example',
      issueDate: addDaysISO(todayISO(), -3),
      dueDate: addDaysISO(todayISO(), 11),
      taxRate: 10,
      notes: '',
      items: [
        { description: 'Menu redesign', quantity: 1, unitPrice: 650 },
        { description: 'Print-ready artwork', quantity: 2, unitPrice: 90 },
      ],
    },
    status: 'sent',
  },
  {
    payload: {
      clientName: 'Northwind Labs',
      clientEmail: 'ap@northwind.example',
      issueDate: addDaysISO(todayISO(), -35),
      dueDate: addDaysISO(todayISO(), -21),
      taxRate: 10,
      notes: 'Paid via Stripe test checkout.',
      items: [
        { description: 'Landing page build', quantity: 1, unitPrice: 2200 },
        { description: 'Consulting call', quantity: 3, unitPrice: 120 },
      ],
    },
    status: 'paid',
  },
];

export default function Dashboard() {
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/invoices', { cache: 'no-store' });
      if (!res.ok) throw new Error('request failed');
      const data = (await res.json()) as { invoices: Invoice[] };
      setInvoices(data.invoices);
      setError(null);
    } catch {
      setError('Could not load invoices from the server.');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function loadSamples() {
    setSeeding(true);
    try {
      for (const sample of SAMPLES) {
        const res = await fetch('/api/invoices', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(sample.payload),
        });
        if (!res.ok) throw new Error('create failed');
        const data = (await res.json()) as { invoice: Invoice };
        await fetch(`/api/invoices/${data.invoice.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: sample.status }),
        });
      }
      await refresh();
    } catch {
      setError('Could not load sample invoices.');
    } finally {
      setSeeding(false);
    }
  }

  if (invoices === null && !error) {
    return (
      <>
        <div className="spinner" />
        <p className="loading-text">Loading dashboard…</p>
      </>
    );
  }

  const list = invoices ?? [];
  const sumFor = (status: Invoice['status']) =>
    list
      .filter((invoice) => invoice.status === status)
      .reduce((sum, invoice) => sum + computeTotals(invoice.items, invoice.taxRate).total, 0);
  const countFor = (status: Invoice['status']) =>
    list.filter((invoice) => invoice.status === status).length;

  const outstandingTotal = sumFor('sent');
  const paidTotal = sumFor('paid');
  const draftTotal = sumFor('draft');
  const allTotal = list.reduce(
    (sum, invoice) => sum + computeTotals(invoice.items, invoice.taxRate).total,
    0,
  );
  const overdueCount = list.filter(
    (invoice) => invoice.status !== 'paid' && invoice.dueDate < todayISO(),
  ).length;

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-sub">Track what you&rsquo;ve billed and what&rsquo;s still outstanding.</p>
        </div>
        <Link href="/invoices/new" className="btn btn-primary">
          + New Invoice
        </Link>
      </div>

      {error && <div className="form-error">{error}</div>}

      <div className="stat-grid">
        <div className="stat-card accent-outstanding">
          <div className="stat-label">Outstanding</div>
          <div className="stat-value">{formatMoney(outstandingTotal)}</div>
          <div className="stat-hint">
            {countFor('sent')} sent · awaiting payment
            {overdueCount > 0 && (
              <>
                {' · '}
                <span style={{ color: 'var(--danger)', fontWeight: 600 }}>{overdueCount} overdue</span>
              </>
            )}
          </div>
        </div>
        <div className="stat-card accent-paid">
          <div className="stat-label">Paid</div>
          <div className="stat-value">{formatMoney(paidTotal)}</div>
          <div className="stat-hint">
            {countFor('paid')} invoice{countFor('paid') === 1 ? '' : 's'} collected
          </div>
        </div>
        <div className="stat-card accent-draft">
          <div className="stat-label">Drafts</div>
          <div className="stat-value">{formatMoney(draftTotal)}</div>
          <div className="stat-hint">{countFor('draft')} not sent yet</div>
        </div>
        <div className="stat-card accent-total">
          <div className="stat-label">Total invoiced</div>
          <div className="stat-value">{formatMoney(allTotal)}</div>
          <div className="stat-hint">
            {list.length} invoice{list.length === 1 ? '' : 's'} overall
          </div>
        </div>
      </div>

      {list.length === 0 ? (
        <div className="card empty-state">
          <div className="empty-icon">🧾</div>
          <h2>No invoices yet</h2>
          <p>Create your first invoice, or load a few samples to see how it works.</p>
          <div className="empty-actions">
            <Link href="/invoices/new" className="btn btn-primary">
              Create an invoice
            </Link>
            <button className="btn btn-outline" onClick={loadSamples} disabled={seeding}>
              {seeding ? 'Loading…' : 'Load sample invoices'}
            </button>
          </div>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Client</th>
                <th>Issued</th>
                <th>Due</th>
                <th style={{ textAlign: 'right' }}>Total</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((invoice) => {
                const totals = computeTotals(invoice.items, invoice.taxRate);
                return (
                  <tr key={invoice.id}>
                    <td className="cell-strong">
                      <Link href={`/invoices/${invoice.id}`}>{invoice.number}</Link>
                    </td>
                    <td>
                      {invoice.clientName}
                      {invoice.clientEmail && (
                        <span className="cell-sub">{invoice.clientEmail}</span>
                      )}
                    </td>
                    <td>{formatDate(invoice.issueDate)}</td>
                    <td>{formatDate(invoice.dueDate)}</td>
                    <td className="amount">{formatMoney(totals.total)}</td>
                    <td>
                      <StatusBadge invoice={invoice} />
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <Link href={`/invoices/${invoice.id}`} className="btn btn-outline btn-sm">
                        View
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
