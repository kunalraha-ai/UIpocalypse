import Link from 'next/link';

export default async function CheckoutCancelPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const invoiceId = typeof sp.invoice_id === 'string' ? sp.invoice_id : undefined;

  return (
    <div className="result-wrap">
      <div className="result-card">
        <div className="result-icon cancel">✕</div>
        <h1>Payment cancelled</h1>
        <p>
          No charge was made{invoiceId ? ' — the invoice is still awaiting payment' : ''}. You can
          complete the checkout any time.
        </p>
        <div className="result-actions">
          {invoiceId && (
            <Link className="btn btn-outline" href={`/invoices/${invoiceId}`}>
              Back to invoice
            </Link>
          )}
          <Link className="btn btn-ghost" href="/">
            Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
