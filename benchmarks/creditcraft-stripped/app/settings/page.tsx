import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/session';
import SettingsPanel from '@/components/SettingsPanel';

export default async function SettingsPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  return <SettingsPanel />;
}
