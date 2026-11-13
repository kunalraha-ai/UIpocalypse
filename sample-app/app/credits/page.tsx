import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/session';
import BuyCredits from '@/components/BuyCredits';

export default async function CreditsPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  return <BuyCredits initialCredits={user.credits} />;
}
