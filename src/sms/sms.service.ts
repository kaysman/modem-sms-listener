import { Injectable, Logger } from '@nestjs/common';
import { Response } from 'express';
import { NatsService } from '../nats/nats.service';
import { parseBarioxMessage } from '../utils/parse-bariox';
import { parseTrackerMessage } from '../utils/parse-tracker';
import { GpsData } from '../utils/build-gps-data';

export interface SmsEvent {
  sender: string;
  dateTimeSent: string;
  message: string | null;
  gps?: GpsData;
  receivedAt?: string;
}

const BUFFER_SIZE = 100;

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);
  private readonly recent: SmsEvent[] = [];
  private readonly sseClients = new Set<Response>();
  private simNumber: string | null = null;

  constructor(private readonly natsService: NatsService) {}

  setSimNumber(num: string) {
    this.simNumber = num;
  }

  getSimNumber() {
    return this.simNumber;
  }

  getRecent(): SmsEvent[] {
    return this.recent;
  }

  getSseClientCount(): number {
    return this.sseClients.size;
  }

  addSseClient(res: Response) {
    this.sseClients.add(res);
    this.logger.log(`SSE client connected (${this.sseClients.size} total)`);
  }

  removeSseClient(res: Response) {
    this.sseClients.delete(res);
    this.logger.log(`SSE client disconnected (${this.sseClients.size} total)`);
  }

  notifyIncomingSms(event: Omit<SmsEvent, 'receivedAt'>) {
    const entry: SmsEvent = { ...event, receivedAt: new Date().toISOString() };
    this.recent.push(entry);
    if (this.recent.length > BUFFER_SIZE) this.recent.shift();
    const payload = `data: ${JSON.stringify(entry)}\n\n`;
    for (const res of this.sseClients) {
      try {
        res.write(payload);
      } catch {
        // connection already closed
      }
    }
  }

  handleMessage(port: string, messageDetails: any[]) {
    this.logger.log(`[${port}] NEW SMS RECEIVED!`);
    for (const msg of messageDetails) {
      if (!msg.message) {
        this.logger.log(`  From   : ${msg.sender}`);
        this.logger.log(`  Time   : ${msg.dateTimeSent}`);
        this.logger.log(`  Raw    : (no text — likely a delivery report or unsupported PDU type)`);
        this.notifyIncomingSms({
          sender: msg.sender,
          dateTimeSent: msg.dateTimeSent,
          message: null,
        });
        continue;
      }

      const parsed = parseTrackerMessage(msg.message) ?? parseBarioxMessage(msg.message);
      if (!parsed) {
        this.logger.log(`  From   : ${msg.sender}`);
        this.logger.log(`  Time   : ${msg.dateTimeSent}`);
        this.logger.log(`  Raw    : ${msg.message}`);
        this.notifyIncomingSms({
          sender: msg.sender,
          dateTimeSent: msg.dateTimeSent,
          message: msg.message,
        });
        continue;
      }

      const gps = this.natsService.publishGpsLocation(parsed);
      this.logger.log(`  Tracker : ${gps.serial_no}`);
      this.logger.log(`  SIM     : ${msg.sender}`);
      this.logger.log(`  DateTime: ${gps.datetime}`);
      this.logger.log(`  Raw     : ${msg.message}`);
      this.logger.log(`  Maps    : https://www.google.com/maps?q=${gps.lat},${gps.lng}`);
      this.notifyIncomingSms({
        sender: msg.sender,
        dateTimeSent: msg.dateTimeSent,
        message: msg.message,
        gps,
      });
    }
  }
}
