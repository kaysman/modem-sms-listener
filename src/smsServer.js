import { createServer } from 'http';
import { appendFile, readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join, normalize } from 'path';
import { publishGpsLocation } from './natsClient.js';

const HTTP_PORT = Number(process.env.HTTP_PORT ?? 3000);
const HTTP_HOST = process.env.HTTP_HOST ?? '127.0.0.1';
const ARCHIVE_FILE = process.env.GPS_ARCHIVE_FILE ?? 'data/gps-archive.jsonl';
const SENT_FILE = process.env.SMS_SENT_FILE ?? 'data/sms-sent.jsonl';
const HISTORY_LIMIT = 200;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
const MAX_BODY = 16 * 1024;
const BUFFER_SIZE = 100;

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_DIR = join(__dirname, '..', 'web');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const sseClients = new Set();
const recent = [];
let simNumber = null;

export function setSimNumber(num) {
  simNumber = num;
}

export function notifyIncomingSms(event) {
  const entry = { ...event, receivedAt: new Date().toISOString() };
  recent.push(entry);
  if (recent.length > BUFFER_SIZE) recent.shift();
  const payload = `data: ${JSON.stringify(entry)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(payload);
    } catch {
      // ignore — connection already closed
    }
  }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY) {
        req.destroy();
        reject(new Error('request body too large'));
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try { resolve(JSON.parse(body)); }
      catch (err) { reject(new Error(`invalid JSON: ${err.message}`)); }
    });
    req.on('error', reject);
  });
}

function sendJson(res, code, data) {
  if (res.writableEnded) return;
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// `serialport-gsm` invokes a 1-arg callback twice (queued + sent). Declaring it
// with 2 args fires only on actual send completion.
function sendSms(device, to, message) {
  return new Promise((resolve) => {
    device.sendSMS(to, message, false, (result, _err) => resolve(result));
  });
}

async function readJsonlTail(filePath, limit) {
  try {
    const content = await readFile(filePath, 'utf8');
    const lines = content.split('\n').filter(Boolean).slice(-limit);
    const out = [];
    for (const line of lines) {
      try { out.push(JSON.parse(line)); }
      catch { /* skip malformed */ }
    }
    return out;
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

// Reads a JSONL file and returns a newest-first page slice plus the total
// line count (after date filter). `from` and `to` are YYYY-MM-DD strings;
// `to` is inclusive (end-of-day).
async function readJsonlPage(filePath, page, pageSize, from, to) {
  try {
    const content = await readFile(filePath, 'utf8');
    const all = [];
    for (const line of content.split('\n')) {
      if (!line) continue;
      try { all.push(JSON.parse(line)); }
      catch { /* skip malformed */ }
    }
    let filtered = all;
    if (from || to) {
      const fromMs = from ? new Date(from).getTime() : -Infinity;
      // If `to` is a bare YYYY-MM-DD treat as end-of-day; if it already has a
      // time component, trust what the client sent.
      const toMs = to
        ? (to.includes('T') ? new Date(to).getTime() : new Date(to + 'T23:59:59.999').getTime())
        : Infinity;
      filtered = all.filter((e) => {
        const t = new Date(e.datetime).getTime();
        if (isNaN(t)) return true;
        return t >= fromMs && t <= toMs;
      });
    }
    const total = filtered.length;
    const start = Math.max(0, total - page * pageSize);
    const end = total - (page - 1) * pageSize;
    const entries = filtered.slice(start, end).reverse();
    return { entries, total, page, pageSize };
  } catch (err) {
    if (err.code === 'ENOENT') return { entries: [], total: 0, page, pageSize };
    throw err;
  }
}

async function appendSentLog(entry) {
  try {
    await appendFile(SENT_FILE, JSON.stringify(entry) + '\n');
  } catch (err) {
    console.error(`[http] failed to append sent log: ${err.message}`);
  }
}

function handleSse(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  res.write('retry: 3000\n\n');
  for (const entry of recent) {
    res.write(`data: ${JSON.stringify(entry)}\n\n`);
  }
  sseClients.add(res);
  console.log(`[http] SSE client connected (${sseClients.size} total)`);
  const keepalive = setInterval(() => {
    try { res.write(': ping\n\n'); } catch { /* connection already closed */ }
  }, 25000);
  req.on('close', () => {
    clearInterval(keepalive);
    sseClients.delete(res);
    console.log(`[http] SSE client disconnected (${sseClients.size} total)`);
  });
}

async function serveStatic(req, res) {
  const urlPath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const safe = normalize(urlPath).replace(/^([\/\\])+/, '');
  if (safe.includes('..')) return sendJson(res, 400, { error: 'bad path' });
  const filePath = join(WEB_DIR, safe);
  if (!filePath.startsWith(WEB_DIR)) return sendJson(res, 400, { error: 'bad path' });
  const ext = '.' + safe.split('.').pop();
  try {
    const data = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' });
    res.end(data);
  } catch (err) {
    if (err.code === 'ENOENT') return sendJson(res, 404, { error: 'not found' });
    sendJson(res, 500, { error: err.message });
  }
}

export function startSmsServer(device, modemPort) {
  const server = createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/events') {
        return handleSse(req, res);
      }
      if (req.method === 'GET' && req.url === '/health') {
        return sendJson(res, 200, {
          ok: true,
          port: modemPort,
          simNumber,
          sseClients: sseClients.size,
          buffered: recent.length,
        });
      }
      if (req.method === 'GET' && req.url.startsWith('/sms/inbox/archive')) {
        const params = new URL(req.url, 'http://localhost').searchParams;
        const page = Math.max(1, Number(params.get('page')) || 1);
        const requested = Number(params.get('pageSize')) || DEFAULT_PAGE_SIZE;
        const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, requested));
        const from = params.get('from') || null;
        const to = params.get('to') || null;
        const result = await readJsonlPage(ARCHIVE_FILE, page, pageSize, from, to);
        return sendJson(res, 200, result);
      }
      if (req.method === 'GET' && req.url === '/sms/sent') {
        const entries = await readJsonlTail(SENT_FILE, HISTORY_LIMIT);
        return sendJson(res, 200, entries);
      }
      if (req.method === 'POST' && req.url === '/gps/replay') {
        try {
          const content = await readFile(ARCHIVE_FILE, 'utf8');
          const lines = content.split('\n').filter(Boolean);
          let published = 0;
          let failed = 0;
          for (const line of lines) {
            try {
              publishGpsLocation(JSON.parse(line), { archive: false });
              published += 1;
            } catch {
              failed += 1;
            }
          }
          console.log(`[http] /gps/replay → published ${published}, failed ${failed}`);
          return sendJson(res, 200, { published, failed, total: lines.length });
        } catch (err) {
          if (err.code === 'ENOENT') return sendJson(res, 404, { error: 'archive file not found' });
          return sendJson(res, 500, { error: err.message });
        }
      }
      if (req.method === 'POST' && req.url === '/sms/send') {
        const { to, message } = await readJson(req);
        if (!to || !message) return sendJson(res, 400, { error: 'missing to/message' });
        const result = await sendSms(device, to, message);
        const isOk = result.status === 'success';
        if (!isOk) {
          console.error(`[http] sendSMS to ${to} failed:`, JSON.stringify(result));
        } else {
          console.log(`[http] sendSMS to ${to} ok (id ${result.data?.messageId ?? '?'})`);
        }
        const entry = {
          ts: new Date().toISOString(),
          to,
          message,
          status: result.status ?? 'fail',
          messageId: result.data?.messageId ?? null,
          error: isOk
            ? null
            : (result.data?.response
                ?? result.error?.message
                ?? (result.error ? String(result.error) : null)
                ?? JSON.stringify(result)),
        };
        await appendSentLog(entry);
        return sendJson(res, isOk ? 200 : 502, { ...result, entry });
      }
      if (req.method === 'GET') {
        return serveStatic(req, res);
      }
      sendJson(res, 404, { error: 'not found' });
    } catch (err) {
      sendJson(res, 400, { error: err.message });
    }
  });

  server.listen(HTTP_PORT, HTTP_HOST, () => {
    console.log(`[http] SMS console at http://${HTTP_HOST}:${HTTP_PORT}`);
  });

  server.on('error', (err) => {
    console.error(`[http] server error: ${err.message}`);
  });

  return server;
}
