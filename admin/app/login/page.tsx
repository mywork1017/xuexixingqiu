import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

async function login(formData: FormData) {
  'use server';

  const password = String(formData.get('password') || '');
  if (password && password === process.env.ADMIN_PASSWORD) {
    const cookieStore = await cookies();
    cookieStore.set('admin_session', 'local-admin', {
      httpOnly: true,
      sameSite: 'lax',
      path: '/'
    });
    redirect('/places');
  }

  redirect('/login?error=1');
}

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;

  return (
    <main className="shell">
      <section className="panel" style={{ maxWidth: 420, margin: '12vh auto 0' }}>
        <h1 className="brand">上海学习地图后台</h1>
        <form action={login} className="photo-list">
          <input className="input" name="password" type="password" placeholder="后台密码" />
          {params.error ? <p className="muted">密码不正确</p> : null}
          <button className="button" type="submit">登录</button>
        </form>
      </section>
    </main>
  );
}
