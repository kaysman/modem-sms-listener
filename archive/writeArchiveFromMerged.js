import { readFile, writeFile } from 'fs/promises';

const MERGED = 'gps-merged.json';
const ARCHIVE = 'archive/gps-archive.jsonl';

// SMS datetime is "MM/DD/YY HH:MM:SS" in the device's local time (+05:00 in
// this deployment). Convert to ISO UTC so it matches the existing `ts` shape.
function datetimeToIso(dt) {
  const m = dt?.match(/^(\d{2})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [, mm, dd, yy, hh, mi, ss] = m;
  if (yy === '00') return null;
  return new Date(`20${yy}-${mm}-${dd}T${hh}:${mi}:${ss}+05:00`).toISOString();
}

// Load existing archive lines so we can preserve real `ts` values when they
// exist (and carry forward any SMSes that haven't been folded into merged).
const existingTs = new Map();
const existingByKey = new Map();
try {
  const raw = await readFile(ARCHIVE, 'utf8');
  for (const line of raw.split('\n').filter(Boolean)) {
    const entry = JSON.parse(line);
    const key = `${entry.data.serial_no}|${entry.data.datetime}`;
    if (!existingTs.has(key)) existingTs.set(key, entry.ts);
    existingByKey.set(key, entry);
  }
} catch (err) {
  if (err.code !== 'ENOENT') throw err;
}

const merged = JSON.parse(await readFile(MERGED, 'utf8'));

const out = new Map();
for (const data of merged) {
  const key = `${data.serial_no}|${data.datetime}`;
  const ts = existingTs.get(key) ?? datetimeToIso(data.datetime) ?? new Date().toISOString();
  if (!out.has(key)) out.set(key, { ts, data });
}
for (const [key, entry] of existingByKey) {
  if (!out.has(key)) out.set(key, entry);
}

const sorted = [...out.values()].sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
const jsonl = sorted.map((e) => JSON.stringify(e)).join('\n') + '\n';
await writeFile(ARCHIVE, jsonl);
console.log(`Wrote ${sorted.length} entries → ${ARCHIVE}`);
