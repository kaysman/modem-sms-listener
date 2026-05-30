import { createElement, useEffect, useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import htm from 'htm';

const html = htm.bind(createElement);

function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  const date = d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `${date}, ${time}`;
}

// AudioContext can only start after a user gesture (autoplay policy).
// We initialise lazily; the first interaction (click etc.) unlocks it.
let audioCtx = null;
function ensureAudio() {
  if (!audioCtx) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    audioCtx = new Ctor();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  return audioCtx;
}

function tone(freq, startOffset = 0, durationMs = 120, volume = 0.75) {
  const ctx = ensureAudio();
  if (!ctx) return;
  const now = ctx.currentTime + startOffset;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, now);
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(volume, now + 0.01);
  gain.gain.linearRampToValueAtTime(0, now + durationMs / 1000);
  osc.connect(gain).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + durationMs / 1000 + 0.02);
}

function chimeIncoming() {
  tone(660, 0, 100);
  tone(880, 0.1, 130);
}

function chimeSent() {
  tone(780, 0, 140);
}

// Reconstructs the tracker-format SMS body from a parsed gps object so archive
// entries (which only have the parsed fields) can show the same Raw SMS block
// as live entries. Lossless when the data went through the tracker parser.
function rebuildTrackerSms(gps) {
  if (!gps) return null;
  const [date, time] = (gps.datetime ?? '').split(' ');
  if (!date || !time) return null;
  const lat = Math.abs(gps.lat ?? 0);
  const lng = Math.abs(gps.lng ?? 0);
  const latDir = gps.lat_direction ?? (gps.lat >= 0 ? 'N' : 'S');
  const lngDir = gps.long_direction ?? (gps.lng >= 0 ? 'E' : 'W');
  const n = (v) => (v ?? 0).toString();
  const b = (v) => (v ? 1 : 0);
  return `*${date},${time},${gps.serial_no},${lat},${latDir},${lng},${lngDir},${n(gps.speed)},${n(gps.height)},&,${n(gps.battery)},${b(gps.charging)},${b(gps.unlocked)},${b(gps.chain_break_alarm)},${b(gps.sim_open)},${b(gps.top_cover_open)},${b(gps.motor_fault)}#`;
}

function GpsDetails({ gps }) {
  const flags = [];
  if (gps.charging) flags.push('⚡ charging');
  if (gps.unlocked) flags.push('🔓 unlocked');
  if (gps.chain_break_alarm) flags.push('⚠️ chain break');
  if (gps.sim_open) flags.push('⚠️ sim open');
  if (gps.top_cover_open) flags.push('⚠️ top cover open');
  if (gps.motor_fault) flags.push('⚠️ motor fault');
  return html`
    <dl class="gps">
      <dt>Tracker</dt><dd>${gps.serial_no ?? '—'}</dd>
      <dt>Time</dt><dd>${fmtTime(gps.datetime)}</dd>
      <dt>Location</dt>
      <dd>
        ${gps.lat != null && gps.lng != null
          ? html`<a href=${`https://www.google.com/maps?q=${gps.lat},${gps.lng}`} target="_blank" rel="noopener">
              📍 ${gps.lat}, ${gps.lng}
            </a>`
          : '—'}
      </dd>
      ${gps.speed != null && html`<dt>Speed</dt><dd>${gps.speed}</dd>`}
      ${gps.battery != null && html`<dt>Battery</dt><dd>${gps.battery}</dd>`}
      ${gps.height != null && html`<dt>Height</dt><dd>${gps.height}</dd>`}
      ${flags.length > 0 && html`<dt>Flags</dt><dd>${flags.join(' · ')}</dd>`}
    </dl>
  `;
}

function InboxCard({ entry, onDelete }) {
  // entry shapes:
  //   live SMS: { sender, dateTimeSent, message, gps?, receivedAt }
  //   archive : { gps: {...buildGpsData}, source: 'archive' }
  const isArchive = entry.source === 'archive';
  const gps = entry.gps;
  const header = isArchive
    ? html`<span class="msg-from">Tracker ${gps?.serial_no ?? '—'}</span>`
    : html`<span class="msg-from">${entry.sender ?? '(unknown)'}</span>`;
  const time = fmtTime(isArchive ? gps?.datetime : (entry.receivedAt ?? entry.dateTimeSent));
  // Use the real SMS body when we have it; reconstruct from the parsed
  // fields for archive entries so every card has a Raw SMS section.
  const rawSms = entry.message ?? (gps ? rebuildTrackerSms(gps) : null);
  const hasNoText = !isArchive && !entry.message && !gps;
  return html`
    <div class=${'msg' + (hasNoText ? ' no-text' : '')}>
      <div class="msg-head">
        <span>${header}<span class="msg-sep"> · </span><span class="msg-time">${time}</span></span>
        <span class="head-actions">
          ${isArchive && html`<span class="badge muted">archive</span>`}
          <button type="button" class="delete-btn" title="Remove" onClick=${onDelete}>×</button>
        </span>
      </div>
      ${gps && html`<${GpsDetails} gps=${gps} />`}
      ${rawSms && html`<details class="raw"><summary>Raw SMS</summary><div class="msg-body">${rawSms}</div></details>`}
      ${hasNoText && html`<div class="msg-body">(no text — likely a delivery report)</div>`}
    </div>
  `;
}

function SentCard({ entry, onDelete }) {
  const ok = entry.status === 'success';
  return html`
    <div class=${'msg sent ' + (ok ? 'ok' : 'err')}>
      <div class="msg-head">
        <span><span class="arrow">→</span> <span class="msg-from">${entry.to}</span><span class="msg-sep"> · </span><span class="msg-time">${fmtTime(entry.ts)}</span></span>
        <span class="head-actions">
          <span class=${'badge ' + (ok ? 'ok' : 'err')}>${ok ? '✓ sent' : '✗ failed'}</span>
          <button type="button" class="delete-btn" title="Remove" onClick=${onDelete}>×</button>
        </span>
      </div>
      <div class="msg-body">${entry.message}</div>
      ${!ok && entry.error && html`<div class="send-status err">${entry.error}</div>`}
    </div>
  `;
}

const DIAL_PREFIX = '+993';
const LOCAL_DIGITS = 8;

function SendForm({ onSent }) {
  const [digits, setDigits] = useState('');
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState({ kind: 'idle', text: '' });

  async function submit(e) {
    e.preventDefault();
    const to = DIAL_PREFIX + digits;
    setPending(true);
    setStatus({ kind: 'pending', text: 'Sending…' });
    try {
      const res = await fetch('/sms/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, message }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.entry) onSent?.(data.entry);
      if (res.ok && data.status === 'success') {
        setStatus({ kind: 'ok', text: `✓ Sent to ${to}` });
        setMessage('');
        chimeSent();
      } else {
        const err = data.entry?.error ?? data.error ?? `HTTP ${res.status}`;
        setStatus({ kind: 'err', text: '✗ ' + err });
      }
    } catch (err) {
      setStatus({ kind: 'err', text: '✗ ' + err.message });
    } finally {
      setPending(false);
    }
  }

  return html`
    <form onSubmit=${submit} autocomplete="off">
      <label>
        Recipient
        <div class="phone-input">
          <span class="prefix">${DIAL_PREFIX}</span>
          <input
            required
            inputMode="numeric"
            pattern=${`[0-9]{${LOCAL_DIGITS}}`}
            maxLength=${LOCAL_DIGITS}
            placeholder="71061275"
            value=${digits}
            onChange=${(e) => setDigits(e.target.value.replace(/\D/g, '').slice(0, LOCAL_DIGITS))} />
        </div>
      </label>
      <label>
        Message
        <textarea required placeholder="Hello" value=${message} onChange=${(e) => setMessage(e.target.value)} />
      </label>
      <div class="row">
        <div class=${'send-status ' + status.kind}>${status.text}</div>
        <button type="submit" disabled=${pending}>Send</button>
      </div>
    </form>
  `;
}

const ARCHIVE_PAGE_SIZE = 50;

function ReplayButton() {
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState({ kind: 'idle', text: '' });

  async function replay() {
    console.log('[replay] click');
    setPending(true);
    setStatus({ kind: 'pending', text: 'Replaying…' });
    try {
      const res = await fetch('/gps/replay', { method: 'POST' });
      console.log('[replay] response', res.status);
      const data = await res.json().catch(() => ({}));
      console.log('[replay] body', data);
      if (res.ok) {
        const failed = data.failed ? ` (${data.failed} failed)` : '';
        setStatus({ kind: 'ok', text: `✓ Published ${data.published}/${data.total}${failed}` });
      } else {
        setStatus({ kind: 'err', text: '✗ ' + (data.error ?? `HTTP ${res.status}`) });
      }
    } catch (err) {
      console.error('[replay] error', err);
      setStatus({ kind: 'err', text: '✗ ' + err.message });
    } finally {
      setPending(false);
    }
  }

  return html`
    <div class="replay-row">
      <button type="button" class="secondary" onClick=${replay} disabled=${pending}>
        ${pending ? 'Replaying…' : 'Replay archive → NATS'}
      </button>
      <div class=${'send-status ' + status.kind}>${status.text}</div>
    </div>
  `;
}

function Pagination({ page, totalPages, onChange }) {
  if (totalPages <= 1) return null;
  return html`
    <div class="pagination">
      <button type="button" disabled=${page <= 1} onClick=${() => onChange(page - 1)}>←</button>
      <span>${page} / ${totalPages}</span>
      <button type="button" disabled=${page >= totalPages} onClick=${() => onChange(page + 1)}>→</button>
    </div>
  `;
}

function toLocalDt(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0); }
function endOfDay(d)   { return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59); }
function todayRange() {
  const now = new Date();
  return { from: toLocalDt(startOfDay(now)), to: toLocalDt(endOfDay(now)) };
}
function yesterdayRange() {
  const y = new Date(); y.setDate(y.getDate() - 1);
  return { from: toLocalDt(startOfDay(y)), to: toLocalDt(endOfDay(y)) };
}
function last24hRange() {
  const now = new Date();
  return { from: toLocalDt(new Date(now.getTime() - 24*60*60*1000)), to: toLocalDt(now) };
}
function last7dRange() {
  const now = new Date();
  const start = new Date(now); start.setDate(start.getDate() - 7);
  return { from: toLocalDt(startOfDay(start)), to: toLocalDt(now) };
}

function FilterCard({ dateRange, onChange, search, onSearchChange }) {
  const set = (patch) => onChange({ ...dateRange, ...patch });
  return html`
    <section class="card filter-card">
      <h2>Filter</h2>
      <label>
        Search
        <input
          type="text"
          placeholder="sender, tracker ID, message…"
          value=${search}
          onInput=${(e) => onSearchChange(e.target.value)} />
      </label>
      <label>
        From
        <input type="datetime-local" value=${dateRange.from} onChange=${(e) => set({ from: e.target.value })} />
      </label>
      <label>
        To
        <input type="datetime-local" value=${dateRange.to} onChange=${(e) => set({ to: e.target.value })} />
      </label>
      <div class="filter-presets">
        <button type="button" onClick=${() => onChange(todayRange())}>Today</button>
        <button type="button" onClick=${() => onChange(last24hRange())}>Last 24h</button>
        <button type="button" onClick=${() => onChange(yesterdayRange())}>Yesterday</button>
        <button type="button" onClick=${() => onChange(last7dRange())}>Last 7d</button>
        <button type="button" class="link-btn" onClick=${() => onChange({ from: '', to: '' })}>All</button>
      </div>
    </section>
  `;
}

function inDateRange(dateStr, from, to) {
  if (!from && !to) return true;
  const t = new Date(dateStr).getTime();
  if (isNaN(t)) return true;
  if (from && t < new Date(from).getTime()) return false;
  if (to && t > new Date(to).getTime()) return false;
  return true;
}

function App() {
  const [tab, setTab] = useState('inbox');
  const [liveInbox, setLiveInbox] = useState([]);
  const [archive, setArchive] = useState([]);
  const [archivePage, setArchivePage] = useState(1);
  const [archiveTotal, setArchiveTotal] = useState(0);
  const [sent, setSent] = useState([]);
  const [status, setStatus] = useState('connecting…');
  const [simNumber, setSimNum] = useState(null);
  const [dateRange, setDateRange] = useState(() => todayRange());
  const [search, setSearch] = useState('');

  // Reset to page 1 whenever the date filter changes.
  useEffect(() => { setArchivePage(1); }, [dateRange.from, dateRange.to]);

  // Fetch the current archive page (with current date filter).
  useEffect(() => {
    let cancelled = false;
    const fetchStart = Date.now();
    const params = new URLSearchParams({ page: archivePage, pageSize: ARCHIVE_PAGE_SIZE });
    if (dateRange.from) params.set('from', dateRange.from);
    if (dateRange.to) params.set('to', dateRange.to);
    fetch(`/sms/inbox/archive?${params}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const items = (data.entries ?? []).map((gps) => ({ source: 'archive', gps }));
        setArchive(items);
        setArchiveTotal(data.total ?? items.length);
        // The listener writes to the archive file before publishing on SSE, so
        // any live entry whose `receivedAt` is older than this fetch is in
        // `archiveTotal` already. Drop them so the badge and list don't double
        // count.
        setLiveInbox((prev) => prev.filter((e) => {
          const t = new Date(e.receivedAt).getTime();
          return !isNaN(t) && t >= fetchStart;
        }));
      })
      .catch((err) => console.error('archive load failed', err));
    return () => { cancelled = true; };
  }, [archivePage, dateRange.from, dateRange.to]);

  // Load sent history + SIM number once on mount.
  useEffect(() => {
    fetch('/sms/sent')
      .then((r) => r.json())
      .then((rows) => setSent(rows.reverse()))
      .catch((err) => console.error('sent log load failed', err));

    // SIM number comes from AT+CNUM which runs at modem boot — retry a few
    // times in case the UI loads before that completes.
    let cancelled = false;
    let tries = 0;
    async function pollSim() {
      while (!cancelled && tries < 30) {
        try {
          const r = await fetch('/health');
          const data = await r.json();
          if (data.simNumber) { setSimNum(data.simNumber); return; }
        } catch { /* ignore */ }
        tries += 1;
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
    pollSim();
    return () => { cancelled = true; };
  }, []);

  // Live inbox via SSE. Live items stay in their own bucket so paging through
  // the archive doesn't disturb them.
  useEffect(() => {
    const es = new EventSource('/events');
    es.onopen = () => setStatus('live');
    es.onerror = () => setStatus('reconnecting…');
    es.onmessage = (ev) => {
      try {
        const evt = JSON.parse(ev.data);
        setLiveInbox((prev) => [evt, ...prev].slice(0, 500));
        const ageMs = Date.now() - new Date(evt.receivedAt).getTime();
        if (ageMs >= 0 && ageMs < 5000) chimeIncoming();
      } catch (err) {
        console.error('bad event', err);
      }
    };
    return () => es.close();
  }, []);

  const handleSent = useCallback((entry) => {
    setSent((prev) => [entry, ...prev].slice(0, 500));
  }, []);

  const removeInbox = useCallback((entry) => {
    setLiveInbox((prev) => prev.filter((e) => e !== entry));
    setArchive((prev) => prev.filter((e) => e !== entry));
  }, []);
  const removeSent = useCallback((entry) => {
    setSent((prev) => prev.filter((e) => e !== entry));
  }, []);

  const totalPages = Math.max(1, Math.ceil(archiveTotal / ARCHIVE_PAGE_SIZE));
  function matchesSearch(entry) {
    if (!search) return true;
    const q = search.toLowerCase();
    return [entry.sender, entry.to, entry.message, entry.gps?.serial_no]
      .filter(Boolean)
      .some((f) => String(f).toLowerCase().includes(q));
  }

  const filteredLive = liveInbox.filter((e) =>
    inDateRange(e.receivedAt ?? e.dateTimeSent ?? e.gps?.datetime, dateRange.from, dateRange.to) &&
    matchesSearch(e));
  const inboxItems = (archivePage === 1 ? [...filteredLive, ...archive] : archive).filter(matchesSearch);
  const inboxCount = filteredLive.length + archiveTotal;
  const filteredSent = sent.filter((e) => inDateRange(e.ts, dateRange.from, dateRange.to) && matchesSearch(e));

  return html`
    <header>
      <h1>Bariox SMS Console</h1>
      <div class="header-right">
        ${simNumber && html`<span class="sim">${simNumber}</span>`}
        <div class=${'status ' + (status === 'live' ? 'live' : '')}>
          <span class="dot"></span>${status}
        </div>
      </div>
    </header>
    <main>
      <section class="card">
        <h2>Send SMS</h2>
        <${SendForm} onSent=${handleSent} />
        <${ReplayButton} />
      </section>
      <section class="card">
        <div class="toolbar">
          <div class="tabs">
            <button class=${tab === 'inbox' ? 'active' : ''} onClick=${() => setTab('inbox')}>
              Inbox <span class="count">${inboxCount}</span>
            </button>
            <button class=${tab === 'sent' ? 'active' : ''} onClick=${() => setTab('sent')}>
              Sent <span class="count">${filteredSent.length}</span>
            </button>
          </div>
          <div class="toolbar-right">
            ${tab === 'inbox' && html`<${Pagination} page=${archivePage} totalPages=${totalPages} onChange=${setArchivePage} />`}
          </div>
        </div>
        ${tab === 'inbox'
          ? (inboxItems.length === 0
              ? html`<div class="empty">No messages match.</div>`
              : html`<div class="inbox">${inboxItems.map((m, i) => html`<${InboxCard} key=${i} entry=${m} onDelete=${() => removeInbox(m)} />`)}</div>`)
          : (filteredSent.length === 0
              ? html`<div class="empty">No messages sent.</div>`
              : html`<div class="inbox">${filteredSent.map((m, i) => html`<${SentCard} key=${i} entry=${m} onDelete=${() => removeSent(m)} />`)}</div>`)}
      </section>
      <${FilterCard} dateRange=${dateRange} onChange=${setDateRange} search=${search} onSearchChange=${setSearch} />
    </main>
  `;
}

createRoot(document.getElementById('root')).render(html`<${App} />`);
