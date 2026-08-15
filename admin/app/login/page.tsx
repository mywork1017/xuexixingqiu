import { redirect } from 'next/navigation';
import { isAdmin } from '@/lib/auth';
import { login } from './actions';
import { LoginView } from './login-view';

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await isAdmin()) {
    redirect('/places');
  }

  const params = await searchParams;

  return <LoginView error={Boolean(params.error)} loginAction={login} />;
}
