const fs = require('node:fs');
const path = require('node:path');
const {
  parsePlacesCsv,
  placesToImportDocuments
} = require('../miniprogram/utils/place-utils');

const rootDir = path.join(__dirname, '..');
const csvPath = path.join(rootDir, 'data', 'places-template.csv');
const outputPath = path.join(rootDir, 'data', 'places-import.json');

const places = parsePlacesCsv(fs.readFileSync(csvPath, 'utf8'));
const documents = placesToImportDocuments(places);

fs.writeFileSync(outputPath, `${JSON.stringify(documents, null, 2)}\n`);

console.log(`Wrote ${documents.length} places to ${path.relative(rootDir, outputPath)}`);
