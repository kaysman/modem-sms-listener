import { connect, JSONCodec } from 'nats';
import { appendFile, readFile, rename, unlink } from 'fs/promises';

const NATS_URL = process.env.NATS_URL;
const FALLBACK_FILE = process.env.GPS_FALLBACK_FILE ?? 'gps-fallback.jsonl';
const ARCHIVE_FILE = process.env.GPS_ARCHIVE_FILE ?? 'gps-archive.jsonl';

if (!NATS_URL) {
  console.error(`[nats] NATS_URL is not set — GPS location events will be written to ${FALLBACK_FILE}`);
}

const jc = JSONCodec();
let nc = null;
let isConnected = false;
let isDraining = false;

const RETRY_DELAY_MS = 5000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function watchConnection() {
  if (!nc) return;
  let lastStatus = null;
  try {
    for await (const status of nc.status()) {
      const key = `${status.type}:${status.data ?? ''}`;
      if (key !== lastStatus) {
        console.log(`[nats] status: ${status.type}${status.data ? ` (${status.data})` : ''}`);
        lastStatus = key;
      }
      if (status.type === 'reconnect') {
        isConnected = true;
        drainFallback();
      } else if (status.type === 'disconnect' || status.type === 'reconnecting') {
        isConnected = false;
      }
    }
  } catch (err) {
    console.error(`[nats] status iterator error: ${err.message}`);
  }
}

export async function connectNats() {
  if (!NATS_URL) return;
  let attempt = 0;
  while (true) {
    attempt += 1;
    try {
      nc = await connect({
        servers: NATS_URL,
        reconnect: true,
        maxReconnectAttempts: -1,
        reconnectTimeWait: RETRY_DELAY_MS,
        waitOnFirstConnect: true,
        pingInterval: 20000,
      });
      console.log(`[nats] Connected to ${NATS_URL} (attempt ${attempt})`);
      isConnected = true;
      watchConnection();
      drainFallback();
      nc.closed().then((err) => {
        if (err) {
          console.error(`[nats] Connection closed with error: ${err.message} — reconnecting`);
        } else {
          console.warn('[nats] Connection closed — reconnecting');
        }
        nc = null;
        isConnected = false;
        connectNats();
      });
      return;
    } catch (err) {
      console.error(`[nats] Failed to connect (attempt ${attempt}): ${err.message} — retrying in ${RETRY_DELAY_MS}ms`);
      await sleep(RETRY_DELAY_MS);
    }
  }
}

async function drainFallback() {
  if (isDraining) return;
  isDraining = true;
  const drainFile = `${FALLBACK_FILE}.draining`;
  try {
    try {
      await rename(FALLBACK_FILE, drainFile);
    } catch (err) {
      if (err.code === 'ENOENT') return;
      console.error(`[nats] Failed to rotate fallback file: ${err.message}`);
      return;
    }

    const content = await readFile(drainFile, 'utf8');
    const lines = content.split('\n').filter(Boolean);
    console.log(`[nats] Draining ${lines.length} buffered GPS event(s) from ${FALLBACK_FILE}`);

    const unsent = [];
    for (const line of lines) {
      if (!nc || nc.isClosed() || !isConnected) {
        unsent.push(line);
        continue;
      }
      try {
        const entry = JSON.parse(line);
        nc.publish('gps.location.received', jc.encode(entry.data));
      } catch (err) {
        console.error(`[nats] Drain publish failed: ${err.message}`);
        unsent.push(line);
      }
    }

    if (unsent.length > 0) {
      try {
        await appendFile(FALLBACK_FILE, unsent.join('\n') + '\n');
        console.warn(`[nats] Re-buffered ${unsent.length} unsent event(s) to ${FALLBACK_FILE}`);
      } catch (err) {
        console.error(`[nats] Failed to re-buffer unsent events: ${err.message}`);
      }
    } else {
      console.log(`[nats] Drain complete — all ${lines.length} event(s) published`);
    }

    try {
      await unlink(drainFile);
    } catch (err) {
      console.warn(`[nats] Failed to remove drain file: ${err.message}`);
    }
  } finally {
    isDraining = false;
  }
}

async function appendToArchive(data) {
  const line = JSON.stringify({ ts: new Date().toISOString(), data }) + '\n';
  try {
    await appendFile(ARCHIVE_FILE, line);
  } catch (err) {
    console.error(`[nats] Failed to write archive file ${ARCHIVE_FILE}: ${err.message}`);
  }
}

async function appendToFallback(data, reason) {
  const line = JSON.stringify({ ts: new Date().toISOString(), data }) + '\n';
  try {
    await appendFile(FALLBACK_FILE, line);
    console.warn(`[nats] ${reason} — wrote GPS data to ${FALLBACK_FILE}`);
  } catch (err) {
    console.error(`[nats] Failed to write fallback file ${FALLBACK_FILE}: ${err.message}`);
  }
}

export function publishGpsLocation(data) {
  appendToArchive(data);
  if (!nc || nc.isClosed() || !isConnected) {
    appendToFallback(data, 'Not connected');
    return;
  }
  try {
    nc.publish('gps.location.received', jc.encode(data));
  } catch (err) {
    appendToFallback(data, `Publish failed: ${err.message}`);
  }
}
