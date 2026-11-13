import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/session';
import ProfileForm from '@/components/ProfileForm';

export default async function ProfilePage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  return <ProfileForm initialName={user.name} credits={user.credits} />;
}
