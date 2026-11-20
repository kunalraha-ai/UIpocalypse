import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/session';
import OrdersList from '@/components/OrdersList';

export default async function OrdersPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  return <OrdersList />;
}
