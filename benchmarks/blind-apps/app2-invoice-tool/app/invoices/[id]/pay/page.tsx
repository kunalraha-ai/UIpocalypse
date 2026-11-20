import PaySimulator from '@/components/PaySimulator';

export default async function PayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PaySimulator invoiceId={id} />;
}
