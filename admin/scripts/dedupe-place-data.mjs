import fs from 'node:fs/promises';
import path from 'node:path';

process.env.DATABASE_URL ||= 'file:./dev.db';

const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient();
const applyChanges = process.argv.includes('--apply');

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/上海市?/g, '')
    .replace(/[（(【\[].*?[）)】\]]/g, '')
    .replace(/[\s·•,，.。:：;；/\\_\-—&]/g, '');
}

function normalizeAddress(value) {
  return normalizeText(value)
    .replace(/(中国|上海市)/g, '')
    .replace(/号楼/g, '号');
}

function getStreetNumber(value) {
  const normalized = String(value || '').replace(/\s/g, '');
  const matches = [...normalized.matchAll(/([\u4e00-\u9fa5·]+(?:路|街|道|公路|大道))(\d+)号/g)];
  const match = matches.at(-1);
  return match ? `${match[1]}${match[2]}号` : '';
}

function levenshtein(left, right) {
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= right.length; column += 1) {
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1)
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
}

function nameSimilarity(left, right) {
  const first = normalizeText(left);
  const second = normalizeText(right);
  if (!first || !second) return 0;
  return 1 - levenshtein(first, second) / Math.max(first.length, second.length);
}

function distanceMeters(first, second) {
  const coordinates = [first.latitude, first.longitude, second.latitude, second.longitude].map(Number);
  if (!coordinates.every(Number.isFinite) || coordinates.some((value) => value === 0)) return null;
  const [lat1, lon1, lat2, lon2] = coordinates.map((value) => value * Math.PI / 180);
  const deltaLat = lat2 - lat1;
  const deltaLon = lon2 - lon1;
  const haversine = Math.sin(deltaLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function duplicateEvidence(first, second) {
  if (first.category !== second.category) return null;
  const differentAudienceBranch = /少儿/.test(first.name) !== /少儿/.test(second.name);
  if (differentAudienceBranch && normalizeAddress(first.address) !== normalizeAddress(second.address)) return null;
  const firstName = normalizeText(first.name);
  const secondName = normalizeText(second.name);
  const similarity = nameSimilarity(first.name, second.name);
  const distance = distanceMeters(first, second);
  const firstAddress = normalizeAddress(first.address);
  const secondAddress = normalizeAddress(second.address);
  const sameAddress = Boolean(firstAddress && secondAddress && firstAddress === secondAddress);
  const containedAddress = Boolean(
    firstAddress && secondAddress
    && Math.min(firstAddress.length, secondAddress.length) >= 6
    && (firstAddress.includes(secondAddress) || secondAddress.includes(firstAddress))
  );
  const exactName = firstName === secondName;
  const sameStreetNumber = Boolean(
    getStreetNumber(first.address)
    && getStreetNumber(first.address) === getStreetNumber(second.address)
  );
  const containedName = Math.min(firstName.length, secondName.length) >= 4
    && (firstName.includes(secondName) || secondName.includes(firstName));
  const reasons = [];

  if ((sameAddress || containedAddress) && similarity >= 0.25) reasons.push('同类地点地址一致且名称相关');
  else if (exactName && sameStreetNumber) reasons.push('名称一致且道路门牌号一致');
  else if (exactName && distance !== null && distance <= (first.category === '食堂' ? 80 : 250)) {
    reasons.push(`名称一致且距离不超过${first.category === '食堂' ? 80 : 250}米`);
  }
  else if (similarity >= 0.9 && distance !== null && distance <= 120) reasons.push('名称高度相似且距离不超过120米');
  else if (similarity >= 0.82 && distance !== null && distance <= 60) reasons.push('名称相似且距离不超过60米');
  else if (containedName && distance !== null && distance <= 80) reasons.push('名称互相包含且距离不超过80米');

  if (!reasons.length) return null;
  return {
    similarity: Number(similarity.toFixed(3)),
    distanceMeters: distance === null ? null : Math.round(distance),
    sameAddress,
    reasons
  };
}

function completenessScore(place) {
  return (place.latitude && place.longitude ? 25 : 0)
    + (place.address ? Math.min(place.address.length, 20) : 0)
    + (place.hours && place.hours !== '以现场公示为准' ? 10 : 0)
    + (place.description ? 8 : 0)
    + Math.min(place.photos.length * 3, 12);
}

function chooseCanonical(places) {
  return places.slice().sort((left, right) => (
    completenessScore(right) - completenessScore(left)
    || right.updatedAt.getTime() - left.updatedAt.getTime()
  ))[0];
}

function chooseText(places, field, ignored = new Set()) {
  return places
    .map((place) => String(place[field] || '').trim())
    .filter((value) => value && !ignored.has(value))
    .sort((left, right) => right.length - left.length)[0] || '';
}

function chooseName(places) {
  return places.slice().sort((left, right) => (
    right.name.length - left.name.length
    || right.updatedAt.getTime() - left.updatedAt.getTime()
  ))[0].name;
}

const places = await prisma.place.findMany({
  include: { photos: { orderBy: { sortOrder: 'asc' } } },
  orderBy: { updatedAt: 'desc' }
});
const parent = places.map((_, index) => index);

function find(index) {
  if (parent[index] !== index) parent[index] = find(parent[index]);
  return parent[index];
}

function union(left, right) {
  const leftRoot = find(left);
  const rightRoot = find(right);
  if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
}

const pairEvidence = [];
for (let left = 0; left < places.length; left += 1) {
  for (let right = left + 1; right < places.length; right += 1) {
    const evidence = duplicateEvidence(places[left], places[right]);
    if (!evidence) continue;
    pairEvidence.push({
      leftId: places[left].id,
      rightId: places[right].id,
      ...evidence
    });
    union(left, right);
  }
}

const groupedIndexes = new Map();
places.forEach((_, index) => {
  const root = find(index);
  if (!groupedIndexes.has(root)) groupedIndexes.set(root, []);
  groupedIndexes.get(root).push(index);
});

const groups = [...groupedIndexes.values()]
  .filter((indexes) => indexes.length > 1)
  .map((indexes) => {
    const members = indexes.map((index) => places[index]);
    const canonical = chooseCanonical(members);
    const memberIds = new Set(members.map((place) => place.id));
    return {
      canonical,
      members,
      evidence: pairEvidence.filter((pair) => memberIds.has(pair.leftId) && memberIds.has(pair.rightId))
    };
  })
  .sort((left, right) => right.members.length - left.members.length);

const summary = groups.map(({ canonical, members, evidence }) => ({
  canonical: {
    id: canonical.id,
    name: canonical.name,
    category: canonical.category
  },
  duplicates: members
    .filter((place) => place.id !== canonical.id)
    .map((place) => ({
      id: place.id,
      name: place.name,
      address: place.address,
      distanceMeters: distanceMeters(canonical, place) === null
        ? null
        : Math.round(distanceMeters(canonical, place)),
      similarity: Number(nameSimilarity(canonical.name, place.name).toFixed(3))
    })),
  evidence
}));

if (applyChanges && groups.length) {
  const databasePath = path.resolve(process.cwd(), 'prisma', 'dev.db');
  const backupDirectory = path.resolve(process.cwd(), 'prisma', 'backups');
  const backupPath = path.join(backupDirectory, `dev-before-dedupe-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  await fs.mkdir(backupDirectory, { recursive: true });
  await fs.copyFile(databasePath, backupPath);

  for (const { canonical, members } of groups) {
    const duplicates = members.filter((place) => place.id !== canonical.id);
    const duplicateIds = duplicates.map((place) => place.id);
    const coordinateSource = canonical.latitude && canonical.longitude
      ? canonical
      : members.find((place) => place.latitude && place.longitude);
    const mergedData = {
      name: chooseName(members),
      address: canonical.address || chooseText(members, 'address'),
      latitude: coordinateSource?.latitude || canonical.latitude,
      longitude: coordinateSource?.longitude || canonical.longitude,
      hours: chooseText(members, 'hours', new Set(['以现场公示为准'])) || canonical.hours,
      description: chooseText(members, 'description') || canonical.description
    };

    await prisma.$transaction(async (transaction) => {
      await transaction.place.update({ where: { id: canonical.id }, data: mergedData });
      const existingUrls = new Set(canonical.photos.map((photo) => photo.url));
      let sortOrder = canonical.photos.length;
      for (const duplicate of duplicates) {
        for (const photo of duplicate.photos) {
          if (existingUrls.has(photo.url)) {
            await transaction.placePhoto.delete({ where: { id: photo.id } });
          } else {
            await transaction.placePhoto.update({
              where: { id: photo.id },
              data: { placeId: canonical.id, sortOrder }
            });
            existingUrls.add(photo.url);
            sortOrder += 1;
          }
        }
      }
      await transaction.place.deleteMany({ where: { id: { in: duplicateIds } } });
    });
  }

  console.log(JSON.stringify({
    mode: 'applied',
    backupPath,
    before: places.length,
    mergedGroups: groups.length,
    removedDuplicates: groups.reduce((total, group) => total + group.members.length - 1, 0),
    groups: summary
  }, null, 2));
} else {
  console.log(JSON.stringify({
    mode: 'dry-run',
    rows: places.length,
    candidatePairs: pairEvidence.length,
    mergeGroups: groups.length,
    removableDuplicates: groups.reduce((total, group) => total + group.members.length - 1, 0),
    groups: summary
  }, null, 2));
}

await prisma.$disconnect();
