import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '../..');
process.env.DATABASE_URL ||= `file:${path.join(projectRoot, 'admin', 'prisma', 'dev.db')}`;
const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient();
const applyChanges = process.argv.includes('--apply');
const refreshPhotos = process.argv.includes('--refresh-photos');
const research = path.join(projectRoot, 'data/research/suzhou-place-completion-2026-08-16');
const databasePath = path.join(projectRoot, 'admin/prisma/dev.db');
const backupDirectory = path.join(projectRoot, 'data/backups/suzhou-place-completion-2026-08-16');
const reportPath = path.join(research, applyChanges ? 'apply-report.json' : 'dry-run-report.json');
const uploadRoot = path.join(projectRoot, 'admin/public/uploads/suzhou-2026-08-16');

const payload = JSON.parse(await fs.readFile(path.join(research, 'official-library-api/locations.json'), 'utf8'));
const coverReport = JSON.parse(await fs.readFile(path.join(research, 'official-library-covers/report.json'), 'utf8'));
const apiByTitle = new Map(payload.items.map((item) => [item.title, item]));
const coverByTitle = new Map(coverReport.filter((row) => row.path).map((row) => [row.title, path.resolve(projectRoot, row.path)]));
const foodIds = new Set([
  'cmsv3g49u001jjiuibd1uhtlz', 'cmsv3g49u001mjiuiud5kfr86', 'cmsv3g49u001ljiuixbcjjmed',
  'cmsv4b8dy0006wxckk4p2kqfk', 'cmsv3g49u001kjiuiazp9jj5w', 'cmsv4b8dy0007wxck3vcsujtl',
  'cmsv3g49u001njiui6fxkj7ld'
]);

function isSuzhou(place) {
  return place.name.startsWith('苏州图书馆') || place.name.startsWith('苏州书房') || foodIds.has(place.id);
}

function stableHash(rows) {
  const values = rows.map((row) => ({
    id: row.id, name: row.name, category: row.category, address: row.address,
    latitude: row.latitude, longitude: row.longitude, hours: row.hours,
    description: row.description,
    photos: row.photos.map((photo) => ({ url: photo.url, sortOrder: photo.sortOrder }))
  })).sort((left, right) => left.id.localeCompare(right.id));
  return crypto.createHash('sha256').update(JSON.stringify(values)).digest('hex');
}

function branchTitle(name) {
  if (name === '苏州图书馆' || name === '苏州图书馆北馆') return '';
  return name.match(/（(.+?)）/)?.[1] || '';
}

function conciseLocation(address) {
  const afterNumber = address.match(/(?:号|幢)(.+)$/)?.[1]?.trim();
  if (afterNumber) return `设于${afterNumber}`;
  return `设于${address.replace(/^苏州市?/, '').replace(/^(?:姑苏|虎丘|吴中|相城|吴江)区/, '')}`;
}

const enhancedDescriptions = {
  '苏州图书馆': '免证入馆、免证阅览，设成人阅览区和少年儿童图书馆',
  '苏州图书馆北馆': '免证入馆、免证阅览，设成人阅览区和北馆少年儿童图书馆',
  '苏州图书馆（元和分馆）': '一楼设少儿借阅区，二楼设成人借阅区、报刊区和自习区，馆外设24小时自助借还柜',
  '苏州图书馆（相城分馆）': '设于青橙里·利邻荟商业中心三楼，馆藏2万余册，设约180个座位',
  '苏州图书馆（横山分馆·狮山书房）': '设于活力OK+社区一楼，馆藏2万余册，涵盖文学艺术、少儿绘本、学术专著和热门小说',
  '苏州图书馆（里河分馆）': '设于里河新村118幢东',
  '苏州图书馆（浒墅人家乐居中心分馆）': '设于浒墅人家三区15幢三楼',
  '苏州书房·苏州图书馆国学分馆': '设于阊门饭店12号楼（金阊门）一楼',
  '苏州图书馆（东渚新苑分馆）': '设于科技城（东渚）为民服务中心二楼',
  '万年家邻里食堂': '供应午餐和晚餐，提供苏帮菜及16元四菜一汤套餐，可容纳30余人，并提供老年优惠和送餐服务',
  '光福镇福溪助餐点': '设于福溪社区老年人日间照料中心，按老年人饮食特点每日更新软烂、清淡、营养均衡的餐食',
  '吴江区民政综合服务中心老年食堂': '提供午餐、堂食和自提服务',
  '桃源镇铜罗社区老年食堂': '供应早餐、午餐和晚餐，可容纳约40人',
  '江兴社区耘林暖心食堂': '设于耘林生命公寓一楼，提供堂食服务',
  '裕社·早点来苏心小厨（西美社区助餐点）': '供应苏式馄饨、汤圆等早餐和老年营养餐，优先服务60周岁以上居民',
  '越溪街道珠村社区幸福食堂': '设于珠村华庭综合为老服务中心，可容纳230人，设明厨亮灶并提供少油、少盐、少糖餐食'
};

function sourceFor(place) {
  if (place.name === '苏州图书馆') return {
    title: '苏州图书馆', hours: '周一闭馆，法定节假日开放；周二至周日 09:00-21:00',
    image: coverByTitle.get('苏州图书馆')
  };
  if (place.name === '苏州图书馆北馆') return {
    title: '苏州图书馆北馆', hours: '周一闭馆，法定节假日开放；周二至周日 09:00-21:00',
    image: coverByTitle.get('苏州图书馆北馆')
  };
  if (place.name === '苏州图书馆（狮山商务分馆）' || place.name === '苏州图书馆（横山分馆·狮山书房）') {
    const item = apiByTitle.get('横山分馆');
    return {
      ...item,
      name: '苏州图书馆（横山分馆·狮山书房）',
      address: '苏州高新区竹园路9-1号活力OK+社区一楼',
      latitude: 31.282302,
      longitude: 120.569095,
      hours: item.open_time,
      image: path.join(research, 'current-hengshan.jpg')
    };
  }
  const title = place.name.includes('国学分馆')
    ? '苏州书房·苏州图书馆国学分馆'
    : branchTitle(place.name);
  const item = apiByTitle.get(title);
  if (!item) return null;
  const source = { ...item, hours: item.open_time, image: coverByTitle.get(title) };
  if (title === '里河分馆') source.image = null;
  if (title === '苏州书房·苏州图书馆国学分馆') {
    source.name = title;
    source.address = '苏州市姑苏区新马路阊门饭店12号楼（金阊门）一楼';
    source.latitude = 31.317896;
    source.longitude = 120.606928;
  }
  if (title === '高铁新城分馆') {
    source.address = '苏州市相城区吴韵路88号苏州高铁新城文体商业中心6楼';
    source.latitude = 31.417363;
    source.longitude = 120.633607;
  }
  return source;
}

async function outputPhoto(place, sourceImage) {
  if (!sourceImage) return null;
  const directory = path.join(uploadRoot, place.id);
  const output = path.join(directory, '01.webp');
  await fs.mkdir(directory, { recursive: true });
  const metadata = await sharp(sourceImage).metadata();
  let pipeline = sharp(sourceImage).rotate();
  if (metadata.width === 672 && metadata.height === 557) {
    pipeline = pipeline.extract({ left: 77, top: 59, width: 260, height: 388 });
  }
  await pipeline.resize(960, 960, {
    fit: metadata.width === 672 && metadata.height === 557 ? 'cover' : 'contain',
    background: { r: 255, g: 255, b: 255, alpha: 1 }
  }).webp({ quality: 88 }).toFile(output);
  return `/uploads/suzhou-2026-08-16/${place.id}/01.webp`;
}

const before = await prisma.place.findMany({ include: { photos: { orderBy: { sortOrder: 'asc' } } } });
const shanghaiBefore = before.filter((place) => !isSuzhou(place));
const suzhou = before.filter(isSuzhou);
const planned = suzhou.map((place) => {
  if (place.category === '食堂') return { ...place, description: enhancedDescriptions[place.name] || place.description, source: null };
  const source = sourceFor(place);
  if (!source) throw new Error(`缺少图书馆现行来源：${place.name}`);
  const nextName = source.name || place.name;
  const nextAddress = (source.address || place.address).replace(/^苏州市高新区/, '苏州高新区');
  return {
    ...place,
    name: nextName,
    address: nextAddress.startsWith('苏州') ? nextAddress : nextAddress.startsWith('高新区') ? `苏州${nextAddress}` : `苏州市${nextAddress}`,
    latitude: source.latitude ?? place.latitude,
    longitude: source.longitude ?? place.longitude,
    hours: source.hours,
    description: enhancedDescriptions[nextName] || conciseLocation(nextAddress),
    source
  };
});

const changes = planned.filter((next) => {
  const beforePlace = suzhou.find((place) => place.id === next.id);
  return ['name', 'address', 'latitude', 'longitude', 'hours', 'description'].some((field) => beforePlace[field] !== next[field])
    || (next.category === '图书馆' && (beforePlace.photos.length === 0 || refreshPhotos));
});

let backupPath = '';
if (applyChanges && changes.length) {
  await fs.mkdir(backupDirectory, { recursive: true });
  backupPath = path.join(backupDirectory, `dev-before-completion-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  await fs.copyFile(databasePath, backupPath);
  for (const next of changes) {
    let photoUrl = null;
    if (next.category === '图书馆') photoUrl = await outputPhoto(next, next.source.image);
    if (next.name === '越溪街道珠村社区幸福食堂') {
      photoUrl = await outputPhoto(next, path.join(research, 'official-food-2024112209241107360017.jpg'));
    }
    await prisma.$transaction(async (tx) => {
      await tx.place.update({
        where: { id: next.id },
        data: {
          name: next.name, address: next.address, latitude: next.latitude, longitude: next.longitude,
          hours: next.hours, description: next.description, pushedFingerprint: ''
        }
      });
      if (next.category === '图书馆') {
        await tx.placePhoto.deleteMany({ where: { placeId: next.id } });
      }
      if (photoUrl) {
        await tx.placePhoto.deleteMany({ where: { placeId: next.id } });
        await tx.placePhoto.create({ data: { id: `sz20260816_${next.id}`, placeId: next.id, url: photoUrl, sortOrder: 0 } });
      }
    });
  }
}

const after = await prisma.place.findMany({ include: { photos: { orderBy: { sortOrder: 'asc' } } } });
const shanghaiAfter = after.filter((place) => !isSuzhou(place));
const suzhouAfter = after.filter(isSuzhou);
const report = {
  mode: applyChanges ? 'apply' : 'dry-run',
  generatedAt: new Date().toISOString(),
  backupPath,
  suzhouCountBefore: suzhou.length,
  suzhouCountAfter: suzhouAfter.length,
  changedCount: changes.length,
  hoursBefore: suzhou.filter((place) => place.hours.trim()).length,
  hoursAfter: applyChanges ? suzhouAfter.filter((place) => place.hours.trim()).length : planned.filter((place) => place.hours.trim()).length,
  descriptionsBefore: suzhou.filter((place) => place.description.trim()).length,
  descriptionsAfter: applyChanges ? suzhouAfter.filter((place) => place.description.trim()).length : planned.filter((place) => place.description.trim()).length,
  photosBefore: suzhou.filter((place) => place.photos.length).length,
  photosAfter: applyChanges ? suzhouAfter.filter((place) => place.photos.length).length : planned.filter((place) => place.category === '图书馆').length + 1,
  shanghaiHashBefore: stableHash(shanghaiBefore),
  shanghaiHashAfter: stableHash(shanghaiAfter),
  changes: changes.map((place) => ({ id: place.id, name: place.name, hours: place.hours, description: place.description, image: Boolean(place.source?.image) }))
};
if (report.shanghaiHashBefore !== report.shanghaiHashAfter) throw new Error('上海数据哈希发生变化');
await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
await prisma.$disconnect();
