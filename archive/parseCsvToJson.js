import { readFile, writeFile } from 'fs/promises';
import { parseTrackerMessage } from './src/parseTrackerMessage.js';
import { parseBarioxMessage } from './src/parseBarioxMessage.js';
import { buildGpsData } from './src/buildGpsData.js';

const INPUT = process.argv[2] ?? 'gps-inbox.csv';
const TARGETS = ['2500000010', '2500000012'];

// Parse one CSV line into an array of fields, honoring quoted fields
// that may contain commas. RFC 4180 lite: handles "" as an escaped quote.
function parseCsvLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

const raw = await readFile(INPUT, 'utf8');
const lines = raw.split('\n').filter(Boolean);
const header = parseCsvLine(lines[0]);
const bodyIdx = header.indexOf('body');
if (bodyIdx === -1) throw new Error("CSV header missing 'body' column");

const buckets = Object.fromEntries(TARGETS.map((s) => [s, []]));
let parsedCount = 0;
let skipped = 0;

for (let i = 1; i < lines.length; i += 1) {
  const fields = parseCsvLine(lines[i]);
  const body = fields[bodyIdx];
  if (!body) { skipped += 1; continue; }

  const parsed = parseTrackerMessage(body) ?? parseBarioxMessage(body);
  if (!parsed) { skipped += 1; continue; }
  if (!TARGETS.includes(parsed.serialno)) { skipped += 1; continue; }

  buckets[parsed.serialno].push(buildGpsData(parsed));
  parsedCount += 1;
}

for (const serial of TARGETS) {
  const out = `${serial}.json`;
  await writeFile(out, JSON.stringify(buckets[serial], null, 2) + '\n');
  console.log(`[${serial}] wrote ${buckets[serial].length} entries → ${out}`);
}
console.log(`Parsed ${parsedCount} target rows, skipped ${skipped}`);
