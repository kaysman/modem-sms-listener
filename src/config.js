export const port = process.env.USB_PORT ?? '/dev/ttyUSB2';

export const modemOptions = {
  baudRate: 9600,
  dataBits: 8,
  parity: 'none',
  stopBits: 1,
  flowControl: false,
  autoDeleteOnReceive: true,
  enableConcatenation: true,
  cnmiCommand: 'AT+CNMI=2,1,0,0,0',
};
