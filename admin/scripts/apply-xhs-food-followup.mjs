import fs from 'node:fs/promises';
import path from 'node:path';

process.env.DATABASE_URL ||= 'file:./dev.db';

const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient();
const applyChanges = process.argv.includes('--apply');
const projectRoot = path.resolve(process.cwd(), '..');
const reportDirectory = path.join(projectRoot, 'data', 'research', 'xhs-discovery-2022-2026-08-08');
const reportPath = path.join(reportDirectory, 'food-followup-apply-result.json');

const candidate = {
  name: '陆家嘴街道综合为老服务中心助餐点',
  category: '食堂',
  address: '上海市浦东新区崂山五村555号',
  latitude: 31.2369,
  longitude: 121.516678,
  hours: '',
  description: '',
  pushedFingerprint: '',
  photos: ['/uploads/xhs-discovery/66ab4879000000000901657a/01.jpg']
};

const duplicate = await prisma.place.findFirst({
  where: {
    category: '食堂',
    OR: [{ name: candidate.name }, { address: candidate.address }]
  },
  select: { id: true, name: true, address: true }
});

let backupPath = '';
let created = null;
if (applyChanges && !duplicate) {
  const backupDirectory = path.join(projectRoot, 'data', 'backups', 'xhs-discovery-2026-08-08');
  await fs.mkdir(backupDirectory, { recursive: true });
  backupPath = path.join(backupDirectory, `dev-before-xhs-food-followup-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  await fs.copyFile(path.join(process.cwd(), 'prisma', 'dev.db'), backupPath);
  created = await prisma.place.create({
    data: {
      ...candidate,
      photos: { create: candidate.photos.map((url, sortOrder) => ({ url, sortOrder })) }
    },
    select: { id: true, name: true, address: true }
  });
}

await fs.writeFile(reportPath, `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  applied: applyChanges,
  backupPath,
  duplicate,
  created,
  candidate,
  evidence: {
    xhs: { noteId: '66ab4879000000000901657a', publishedAt: '2024-08-01T10:02:47.000Z', scope: '正文与正文图片，未读取评论' },
    official: '上海市民政局公开信息确认崂山五村555号综合为老服务中心含助餐服务',
    map: 'Apple 地图中国区同址门牌 POI，坐标31.236900,121.516678'
  },
  phonePolicy: '未采集、未保存电话'
}, null, 2)}\n`);

process.stdout.write(`${applyChanges ? '已应用' : '预演'}：新增 ${duplicate ? 0 : 1} 条\n${reportPath}\n`);
await prisma.$disconnect();
