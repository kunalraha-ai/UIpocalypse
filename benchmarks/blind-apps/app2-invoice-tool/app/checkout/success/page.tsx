import CheckoutResult from '@/components/CheckoutResult';

export default async function CheckoutSuccessPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const invoiceId = typeof sp.invoice_id === 'string' ? sp.invoice_id : undefined;
  const sessionId = typeof sp.session_id === 'string' ? sp.session_id : undefined;
  return <CheckoutResult invoiceId={invoiceId} sessionId={sessionId} />;
}
