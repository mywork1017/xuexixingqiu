'use server';

import cloudbase from '@cloudbase/node-sdk';
import { requireAdmin } from '@/lib/auth';
import { getCloudBaseConfig } from '@/lib/cloudbase-sync';
import { prisma } from '@/lib/prisma';

const VISITOR_CODE_PATTERN = /^[A-F0-9]{6}$/;
const VISIT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export async function deleteVisit(id: string) {
  await requireAdmin();
  if (!VISIT_ID_PATTERN.test(id)) return { ok: false as const, error: '访问记录编号无效' };

  const config = getCloudBaseConfig();
  if (!config.env || !config.secretId || !config.secretKey) {
    return { ok: false as const, error: '服务器尚未配置微信云环境凭证' };
  }

  try {
    const app = cloudbase.init({
      env: config.env,
      region: 'ap-shanghai',
      secretId: config.secretId,
      secretKey: config.secretKey
    });
    await app.database()
      .collection(process.env.CLOUDBASE_VISIT_COLLECTION || 'visitLogs')
      .doc(id)
      .remove();
    return { ok: true as const };
  } catch (error) {
    console.error('delete visit failed', error);
    return { ok: false as const, error: '访问记录删除失败' };
  }
}

export async function saveVisitorName(visitorCode: string, value: string) {
  await requireAdmin();
  if (!VISITOR_CODE_PATTERN.test(visitorCode)) {
    return { ok: false as const, error: '访客编号无效' };
  }

  const name = value.trim();
  if (name.length > 30) return { ok: false as const, error: '访客名字最多 30 个字' };

  try {
    if (name) {
      await prisma.visitorAlias.upsert({
        where: { visitorCode },
        create: { visitorCode, name },
        update: { name }
      });
    } else {
      await prisma.visitorAlias.deleteMany({ where: { visitorCode } });
    }
    return { ok: true as const, name };
  } catch (error) {
    console.error('save visitor name failed', error);
    return { ok: false as const, error: '访客名字保存失败' };
  }
}
