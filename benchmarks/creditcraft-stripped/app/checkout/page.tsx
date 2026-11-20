import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/session';
import Checkout from '@/components/Checkout';

export default async function CheckoutPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  return <Checkout />;
}
