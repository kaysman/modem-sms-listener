import { Injectable, Logger, OnApplicationBootstrap, Inject, forwardRef } from '@nestjs/common';
import modem from 'serialport-gsm';
import { SmsService } from '../sms/sms.service';

const USB_PORT = process.env.USB_PORT ?? '/dev/ttyUSB2';
const MODEM_OPTIONS = {
  baudRate: 9600,
  dataBits: 8,
  parity: 'none',
  stopBits: 1,
  flowControl: false,
  autoDeleteOnReceive: true,
  enableConcatenation: true,
  cnmiCommand: 'AT+CNMI=2,1,0,0,0',
};

@Injectable()
export class ModemService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ModemService.name);
  private device: any = null;

  constructor(@Inject(forwardRef(() => SmsService)) private readonly smsService: SmsService) {}

  onApplicationBootstrap() {
    this.device = modem.Modem();

    if (process.env.MODEM_DEBUG === '1') {
      this.device.logger = { debug: (msg: string) => this.logger.debug(`[modem-debug] ${msg}`) };
    }

    this.device.on('open', () => {
      this.logger.log(`[${USB_PORT}] Port Opened`);
      this.initializeModem();
    });

    this.device.on('onNewMessage', (messageDetails: any) => {
      this.smsService.handleMessage(USB_PORT, messageDetails);
    });

    this.device.on('error', (err: any) => {
      this.logger.error(`[${USB_PORT}] Error: ${err?.message ?? err}`);
    });

    this.device.open(USB_PORT, MODEM_OPTIONS);
  }

  getPort(): string {
    return USB_PORT;
  }

  sendSms(to: string, message: string): Promise<any> {
    return new Promise((resolve) => {
      this.device.sendSMS(to, message, false, (result: any, _err: any) => resolve(result));
    });
  }

  private initializeModem() {
    this.device.initializeModem(() => {
      this.logger.log(`[${USB_PORT}] Modem Initialized`);

      this.device.setModemMode((res: any, err: any) => {
        if (err) {
          this.logger.error(`[${USB_PORT}] Failed to set PDU mode: ${err?.message ?? err}`);
          return;
        }
        this.logger.log(`[${USB_PORT}] PDU mode + CNMI set: ${res}`);

        this.logStorageCapacity();
        this.logSimNumber();
        this.drainSimInbox();
      }, false, 30000, 'PDU');
    });
  }

  private drainSimInbox() {
    this.device.getSimInbox((result: any, err: any) => {
      if (err) {
        this.logger.error(`[${USB_PORT}] Failed to read SIM inbox: ${err?.message ?? err}`);
        return;
      }
      const messages = result?.data ?? [];
      this.logger.log(`[${USB_PORT}] SIM inbox: ${messages.length} stored message(s)`);
      if (messages.length > 0) this.smsService.handleMessage(USB_PORT, messages);
    });
  }

  private logStorageCapacity() {
    this.device.executeCommand('AT+CPMS=?', (result: any, err: any) => {
      if (err) {
        this.logger.warn(`[${USB_PORT}] AT+CPMS=? failed: ${err?.message ?? err}`);
        return;
      }
      this.logger.log(`[${USB_PORT}] Supported SMS storages: ${String(result?.data?.result ?? '').trim()}`);
    }, 10000);

    this.device.executeCommand('AT+CPMS?', (result: any, err: any) => {
      if (err) {
        this.logger.warn(`[${USB_PORT}] AT+CPMS? failed: ${err?.message ?? err}`);
        return;
      }
      this.logger.log(`[${USB_PORT}] Current SMS storage: ${String(result?.data?.result ?? '').trim()}`);
    }, 10000);
  }

  private logSimNumber() {
    this.device.executeCommand('AT+CNUM', (result: any, err: any) => {
      if (err) {
        this.logger.warn(`[${USB_PORT}] Could not read SIM number: ${err?.message ?? err}`);
        return;
      }
      const match = String(result?.data ?? result).match(/\+CNUM:[^,]*,"?([^",]+)"?/);
      if (match) {
        this.logger.log(`[${USB_PORT}] SIM phone number: ${match[1]}`);
        this.smsService.setSimNumber(match[1]);
      } else {
        this.logger.log(`[${USB_PORT}] SIM phone number: not provisioned on this SIM`);
      }
    }, 10000);
  }
}
