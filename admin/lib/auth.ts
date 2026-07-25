import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export async function requireAdmin() {
  const cookieStore = await cookies();
  const session = cookieStore.get('admin_session')?.value;

  if (session !== 'local-admin') {
    redirect('/login');
  }
}
