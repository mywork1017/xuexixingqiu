'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createAdminSessionValue, credentialsAreValid } from '@/lib/auth';

export async function login(formData: FormData) {
  const username = String(formData.get('username') || '');
  const password = String(formData.get('password') || '');

  if (!credentialsAreValid(username, password)) {
    redirect('/login?error=1');
  }

  const cookieStore = await cookies();
  cookieStore.set('admin_session', createAdminSessionValue(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/'
  });
  redirect('/places');
}

export async function logout() {
  const cookieStore = await cookies();
  cookieStore.delete('admin_session');
  redirect('/login');
}
