import { parseBarioxMessage } from './parseBarioxMessage.js';
import { parseTrackerMessage } from './parseTrackerMessage.js';
import { publishGpsLocation } from './natsClient.js';
import { notifyIncomingSms } from './smsServer.js';

export function handleMessage(port, messageDetails) {
  console.log(`📩 [${port}] NEW SMS RECEIVED!`);
  for (const msg of messageDetails) {
    if (!msg.message) {
      console.log(`  From   : ${msg.sender}`);
      console.log(`  Time   : ${msg.dateTimeSent}`);
      console.log(`  Raw    : (no text — likely a delivery report or unsupported PDU type)`);
      notifyIncomingSms({
        sender: msg.sender,
        dateTimeSent: msg.dateTimeSent,
        message: null,
      });
      continue;
    }

    const parsed = parseTrackerMessage(msg.message) ?? parseBarioxMessage(msg.message);
    if (!parsed) {
      console.log(`  From   : ${msg.sender}`);
      console.log(`  Time   : ${msg.dateTimeSent}`);
      console.log(`  Raw    : ${msg.message}`);
      notifyIncomingSms({
        sender: msg.sender,
        dateTimeSent: msg.dateTimeSent,
        message: msg.message,
      });
      continue;
    }

    const gps = publishGpsLocation(parsed);
    console.log(`  Tracker : ${gps.serial_no}`);
    console.log(`  SIM     : ${msg.sender}`);
    console.log(`  DateTime: ${gps.datetime}`);
    console.log(`  Raw     : ${msg.message}`);
    console.log(`  📍 Maps : https://www.google.com/maps?q=${gps.lat},${gps.lng}`);
    notifyIncomingSms({
      sender: msg.sender,
      dateTimeSent: msg.dateTimeSent,
      message: msg.message,
      gps,
    });
  }
}
