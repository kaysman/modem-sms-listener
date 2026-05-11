import { connect, JSONCodec } from 'nats';

const NATS_URL = process.env.NATS_URL;

if (!NATS_URL) {
  console.error('[nats] NATS_URL is not set — GPS location events will not be published');
}

const jc = JSONCodec();
let nc = null;

export async function connectNats() {
  if (!NATS_URL) return;
  try {
    nc = await connect({ servers: NATS_URL });
    console.log(`[nats] Connected to ${NATS_URL}`);
    nc.closed().then(() => console.warn('[nats] Connection closed'));
  } catch (err) {
    console.error(`[nats] Failed to connect: ${err.message}`);
  }
}

export function publishGpsLocation(data) {
  if (!nc) return;
  console.log('what sent:');
  console.log(jc.encode(data));
  nc.publish('gps.location.received', jc.encode(data));
}
