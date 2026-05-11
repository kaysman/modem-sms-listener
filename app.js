import modem from 'serialport-gsm';
import { port, modemOptions } from './src/config.js';
import { setupModem } from './src/setupModem.js';
import { handleMessage } from './src/handleMessage.js';
import { connectNats } from './src/natsClient.js';

process.on('uncaughtException', (err) => {
  console.error('Uncaught error (likely bad PDU on wrong port):', err.message);
});

await connectNats();

const device = modem.Modem();

device.on('open', () => {
  console.log(`[${port}] Port Opened`);
  setupModem(device, port);
});

device.on('onNewMessage', (messageDetails) => handleMessage(port, messageDetails));

device.on('error', (err) => {
  console.error(`[${port}] Error:`, err.message ?? err);
});

device.open(port, modemOptions);
