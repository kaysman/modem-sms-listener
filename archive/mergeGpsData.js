import { readFile, writeFile } from 'fs/promises';

const OUTPUT = 'gps-merged.json';
const SOURCES = [
  { path: '2500000010.json', kind: 'json-array' },
  { path: '2500000012.json', kind: 'json-array' },
  { path: 'gps-archive.jsonl', kind: 'jsonl-wrapped' },
  { path: 'gps-archive.old.jsonl', kind: 'jsonl-wrapped-stale-speed-battery' },
];

// Latest canonical shape (mirrors src/buildGpsData.js). Listed here so the
// merge can normalize older sources that are missing newer fields.
const TEMPLATE = {
  serial_no: null,
  datetime: null,
  lat: null,
  lng: null,
  lat_direction: null,
  long_direction: null,
  speed: null,
  battery: null,
  height: null,
  charging: false,
  unlocked: false,
  chain_break_alarm: false,
  sim_open: false,
  top_cover_open: false,
  motor_fault: false,
};

function normalize(entry, kind) {
  const merged = { ...TEMPLATE, ...entry };
  if (kind === 'jsonl-wrapped-stale-speed-battery') {
    // Old archive's speed/battery are recorded as static placeholders, not
    // real telemetry — drop them so they don't pollute the merged dataset.
    merged.speed = null;
    merged.battery = null;
  }
  return merged;
}

function completeness(entry) {
  let score = 0;
  for (const key of Object.keys(TEMPLATE)) {
    const v = entry[key];
    if (v !== null && v !== undefined) score += 1;
  }
  return score;
}

async function loadSource({ path, kind }) {
  let raw;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.warn(`[skip] ${path} not found`);
      return [];
    }
    throw err;
  }
  if (kind === 'json-array') {
    const arr = JSON.parse(raw);
    return arr.map((e) => normalize(e, kind));
  }
  // jsonl-wrapped: each line is `{"ts":"...","data":{...}}`
  return raw
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const parsed = JSON.parse(line);
      return normalize(parsed.data, kind);
    });
}

const all = [];
for (const source of SOURCES) {
  const entries = await loadSource(source);
  console.log(`[${source.path}] loaded ${entries.length} entries`);
  all.push(...entries);
}

// Dedup by (serial_no, datetime); when collision occurs, keep the entry with
// more non-null fields. Ties keep the first seen.
const byKey = new Map();
for (const entry of all) {
  const key = `${entry.serial_no}|${entry.datetime}`;
  const existing = byKey.get(key);
  if (!existing || completeness(entry) > completeness(existing)) {
    byKey.set(key, entry);
  }
}

const merged = [...byKey.values()];

// Sort chronologically by datetime ("MM/DD/YY HH:MM:SS"). Invalid (year 00)
// timestamps land at the end so the bulk of real data reads top-to-bottom.
function parseDate(dt) {
  const match = dt?.match(/^(\d{2})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return Number.POSITIVE_INFINITY;
  const [, mm, dd, yy, hh, mi, ss] = match.map((v, i) => i === 0 ? v : parseInt(v, 10));
  if (yy === 0) return Number.POSITIVE_INFINITY;
  return Date.UTC(2000 + yy, mm - 1, dd, hh, mi, ss);
}
merged.sort((a, b) => parseDate(a.datetime) - parseDate(b.datetime));

await writeFile(OUTPUT, JSON.stringify(merged, null, 2) + '\n');
console.log(`Wrote ${merged.length} merged entries → ${OUTPUT} (deduped from ${all.length})`);
