import { parseBarioxMessage } from './parseBarioxMessage.js';
import { publishGpsLocation } from './natsClient.js';

export function handleMessage(port, messageDetails) {
  console.log(`📩 [${port}] NEW SMS RECEIVED!`);
  for (const msg of messageDetails) {
    const bariox = parseBarioxMessage(msg.message);
    if (!bariox) {
      console.log(`  From   : ${msg.sender}`);
      console.log(`  Time   : ${msg.dateTimeSent}`);
      console.log(`  Message: ${msg.message}`);
      return;
    }

    console.log(`  Tracker : ${bariox.serialno}`);
    console.log(`  SIM     : ${msg.sender}`);
    console.log(`  DateTime: ${bariox.datetime}`);
    console.log(`  📍 Maps : https://www.google.com/maps?q=${bariox.lat},${bariox.lon}`);

    publishGpsLocation({
      serial_no: bariox.serialno,
      lat: bariox.lat,
      lng: bariox.lon,
      speed: bariox.speed,
      battery: bariox.battery,
    });
  }
}
