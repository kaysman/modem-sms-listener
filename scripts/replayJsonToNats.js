import { readFile } from 'fs/promises';
import { connectNats, publishGpsLocation } from '../src/natsClient.js';

const FILES = process.argv.slice(2);
if (FILES.length === 0) {
  console.error('Usage: node replayJsonToNats.js <file.json|.jsonl> [<file> ...]');
  process.exit(1);
}

function parseEntries(file, content) {
  if (file.endsWith('.jsonl')) {
    return content.split('\n').filter(Boolean).map((line) => JSON.parse(line));
  }
  return JSON.parse(content);
}

await connectNats();
// Give the NATS client a moment to finish the initial handshake before publishing.
await new Promise((resolve) => setTimeout(resolve, 500));

let total = 0;
for (const file of FILES) {
  const entries = parseEntries(file, await readFile(file, 'utf8'));
  console.log(`[${file}] publishing ${entries.length} entries`);
  for (const entry of entries) {
    publishGpsLocation(entry, { archive: false });
    total += 1;
  }
}

// Let any buffered NATS writes flush before exiting.
await new Promise((resolve) => setTimeout(resolve, 1000));
console.log(`Done — replayed ${total} entries`);
process.exit(0);
