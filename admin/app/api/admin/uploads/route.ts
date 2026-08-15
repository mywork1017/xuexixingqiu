import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/auth';

const MAX_BYTES = 8 * 1024 * 1024;
const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export async function POST(request: Request) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ ok: false, error: '请先登录' }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get('image');
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: '请选择图片' }, { status: 400 });
  }
  if (!TYPES.has(file.type) || file.size > MAX_BYTES) {
    return NextResponse.json({ ok: false, error: '仅支持 8MB 内的 JPG、PNG、WebP' }, { status: 400 });
  }
  const directory = path.join(process.cwd(), 'public', 'uploads');
  await mkdir(directory, { recursive: true });
  const filename = `${Date.now()}-${crypto.randomUUID()}-square.webp`;
  const squareImage = await sharp(Buffer.from(await file.arrayBuffer()), { failOn: 'error' })
    .rotate()
    .resize(1080, 1080, { fit: 'cover', position: 'attention' })
    .webp({ quality: 86, effort: 5 })
    .toBuffer();
  await writeFile(path.join(directory, filename), squareImage);
  return NextResponse.json({ ok: true, url: `/uploads/${filename}` });
}
