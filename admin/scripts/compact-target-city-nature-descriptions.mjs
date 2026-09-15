import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

process.env.DATABASE_URL ||= 'file:./dev.db';
const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const root = path.resolve(import.meta.dirname, '../..');
const reportRoot = path.join(root, 'data/research/nature-description-cleanup-shanghai-suzhou-2026-09-13');
const apply = process.argv.includes('--apply');

const useful = /(入口|步道|跑道|绿道|栈道|园路|草坪|树林|林下|森林|湿地|湖|河|水岸|滨水|亲水|沙滩|码头|观景|平台|花园|花坛|花廊|花架|亭|廊|桥|广场|座椅|公厕|厕所|停车|无障碍|儿童|滑梯|游乐|健身|篮球|足球|网球|门球|骑行|露营|驿站|茶室|剧场|展馆|温室|植物园|动物园|雕塑|遗址|墓|纪念馆)/;
const filler = /(蒸蒸日上|流连忘返|心旷神怡|景色宜人|环境优美|好去处|充分体现|完美融合|美好生活|独具匠心|提供一处|提供了一个|满足.*需求|打造.*地标|彰显|营造.*氛围|可按该地址导航|属于面向公众|适合|网红|打卡|设计理念|设计思想|设计创意|品质内涵|目标定位|投资|施工|荣誉称号|游客量|开工|竣工|建成|改造完成|正式开放|故.*命名|以.*为主题|以.*为目的|生态功能)/;

function compact(place) {
  const original = String(place.description || '').replace(/\s+/g, '').replaceAll('；', '。').replaceAll(';', '。');
  if (!original) return '';
  if (original.includes('可按该地址导航至公开标注位置')) return '';
  const pieces = original
    .split(/[。！？!?；;：:，,]/)
    .map((item) => item
      .replace(new RegExp(`^${place.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:简介)?`), '')
      .replace(/^(?:本公园|该公园|公园|绿地|园区)/, '')
      .replace(/^位于.{0,60}$/, '')
      .replace(/^(?:园内|公园内|全园)/, '')
      .replace(/^(?:其中|主要|同时|并且|以及|通过|结合)/, '')
      .trim())
    .filter((item) => item.length >= 5 && item.length <= 90 && useful.test(item) && !filler.test(item));
  const selected = [];
  for (const piece of pieces) {
    let clipped = piece;
    if (clipped.length > 64) {
      const prefix = clipped.slice(0, 64);
      const safeEnd = Math.max(prefix.lastIndexOf('、'), prefix.lastIndexOf('）'), prefix.lastIndexOf(')'));
      clipped = safeEnd >= 30 ? prefix.slice(0, safeEnd + 1) : '';
    }
    if (!clipped || selected.some((item) => item.includes(clipped) || clipped.includes(item))) continue;
    selected.push(clipped);
    if (selected.join('；').length >= 130 || selected.length >= 4) break;
  }
  return selected.join('；').replace(/[、，,。；;！!？?]+$/, '').slice(0, 150);
}

const manual = new Map(Object.entries({
  'nature-a8c9abe44dc482b697b4df84': '设有大面积草坪、森林和湖泊，园内分布湖滨区、疏林草坪区、鸟类保护区、国际花园、露天音乐剧场、儿童游乐场、银杏大道和卵石沙滩',
  'nature-b345224edae5fe79d49657d6': '园内保留世博会场馆，设有世博花园、申园、双子山、上海温室和世界花艺园；景观包含森林、湿地、草坪与滨江空间',
  'nature-313ff59364252048cd6e5a5e': '位于黄浦江南岸，园内有连续滨江步道、草坪、银杏和临江观景空间',
  'nature-9fffe62f3d62915942c2720d': '以大面积森林为主体，园内有滨江游览线、林间步道、草坪和儿童游乐设施',
  'nature-e57dc16842e827be5198aaf0': '园内设东、南、北三个主要入口，分布悦林大道、樱花林、森林步道、草坪、儿童活动区和休憩设施',
  'nature-9aff9e9f45bc6136da266e6e': '设大渡河路、枣阳路、云岭路和怒江路四处入口；园内以银锄湖、大草坪和林荫步道为主要空间',
  'nature-d86a03042c62067828173ae5': '园内保留南大门、百年树木和英式园林格局，中部设鲁迅墓、鲁迅纪念馆及草坪、花坛和林荫步道',
  'nature-fd7b3adcf7e4c7bd45252e00': '以大树、草坪、山林和水面为主要景观，园内保留多处历史园林空间',
  'nature-c88fbfab8cbbe63b413a5132': '园内设大草坪、沉床花坛、马克思恩格斯雕像、玫瑰园和林荫步道，雁荡路与复兴中路均有入口',
  'nature-32b77c1b8227ff41d897057b': '园内分布植物专类园、展览温室、盆景园、兰室、草坪和水生植物区，龙吴路设主要入口',
  'nature-9a77831d57dd8ad51301d90e': '园内设矿坑花园、展览温室、华东区系园、盲人植物园和湖区，入口位于辰花路',
  'nature-463fa535adf9770b9d1254b3': '园内分布滨江岸线、生态林、杜鹃园、果园和林间步道，可到达长江口与黄浦江交汇处附近的观景空间',
  'nature-map-5fbe1b8db6adcca121c8cbfd': '园内有湿地水面、木栈道、水车和林地景观，入口设国家湿地公园标识'
}));

const places = await prisma.place.findMany({
  where: { category: '自然', OR: [{ address: { startsWith: '上海市' } }, { address: { startsWith: '苏州市' } }, { address: { startsWith: '苏州高新区' } }] },
  orderBy: { id: 'asc' }
});
const changes = places.map((place) => ({
  id: place.id,
  name: place.name,
  before: place.description,
  after: manual.has(place.id)
    ? manual.get(place.id)
    : compact(place)
})).filter((item) => item.before !== item.after);

await mkdir(reportRoot, { recursive: true });
let backupPath = '';
if (apply) {
  backupPath = path.join(root, 'data/backups/nature-description-cleanup-2026-09-13', `dev-before-description-cleanup-${new Date().toISOString().replaceAll(':', '-')}.db`);
  await mkdir(path.dirname(backupPath), { recursive: true });
  await copyFile(path.join(root, 'admin/prisma/dev.db'), backupPath);
  await prisma.$transaction(changes.map((item) => prisma.place.update({ where: { id: item.id }, data: { description: item.after, pushedFingerprint: '' } })));
}
await prisma.$disconnect();
const report = { generatedAt: new Date().toISOString(), applied: apply, places: places.length, changes: changes.length, blankAfter: changes.filter((item) => !item.after).length, backupPath, records: changes };
await writeFile(path.join(reportRoot, apply ? 'apply-report.json' : 'preview-report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ applied: apply, places: places.length, changes: changes.length, blankAfter: report.blankAfter, backupPath }, null, 2));
