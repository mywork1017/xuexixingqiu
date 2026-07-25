import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';

const MAX_BYTES = 8 * 1024 * 1024;
const TYPES = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp']
]);

export async function POST(request: Request) {
  await requireAdmin();
  const formData = await request.formData();
  const file = formData.get('image');
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: '请选择图片' }, { status: 400 });
  }
  const extension = TYPES.get(file.type);
  if (!extension || file.size > MAX_BYTES) {
    return NextResponse.json({ ok: false, error: '仅支持 8MB 内的 JPG、PNG、WebP' }, { status: 400 });
  }
  const directory = path.join(process.cwd(), 'public', 'uploads');
  await mkdir(directory, { recursive: true });
  const filename = `${Date.now()}-${crypto.randomUUID()}.${extension}`;
  await writeFile(path.join(directory, filename), Buffer.from(await file.arrayBuffer()));
  return NextResponse.json({ ok: true, url: `/uploads/${filename}` });
}
