import fs from 'node:fs';

const [sourceManifestPath, sourceDecisionPath, targetManifestPath, outputPath] = process.argv.slice(2);
if (!outputPath) {
  throw new Error('usage: node scripts/seed-photo-review-decisions.mjs SOURCE_MANIFEST SOURCE_DECISIONS TARGET_MANIFEST OUTPUT');
}

const readJson = (path) => JSON.parse(fs.readFileSync(path, 'utf8'));
const sourceManifest = readJson(sourceManifestPath);
const sourceDecision = readJson(sourceDecisionPath);
const targetManifest = readJson(targetManifestPath);
const key = (image) => `${image.placeId}\t${image.sourceUrl}`;
const targetNumbers = new Map(targetManifest.images.map((image, index) => [key(image), index + 1]));
const sourceRejected = new Set(sourceDecision.rejectedNumbers);
const reviewedNumbers = [];
const rejectedNumbers = [];

for (let index = 0; index < sourceDecision.reviewedThrough; index += 1) {
  const targetNumber = targetNumbers.get(key(sourceManifest.images[index]));
  if (!targetNumber) continue;
  reviewedNumbers.push(targetNumber);
  if (sourceRejected.has(index + 1)) rejectedNumbers.push(targetNumber);
}

reviewedNumbers.sort((left, right) => left - right);
rejectedNumbers.sort((left, right) => left - right);
fs.writeFileSync(outputPath, `${JSON.stringify({ reviewedNumbers, rejectedNumbers }, null, 2)}\n`);
console.log(JSON.stringify({ reviewed: reviewedNumbers.length, rejected: rejectedNumbers.length }));
