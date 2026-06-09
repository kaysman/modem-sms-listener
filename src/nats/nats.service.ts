import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { connect, JSONCodec, NatsConnection } from 'nats';
import { appendFile, readFile, rename, unlink } from 'fs/promises';
import { buildGpsData, GpsData } from '../utils/build-gps-data';

@Injectable()
export class NatsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(NatsService.name);

  private readonly natsUrl = process.env.NATS_URL;
  private readonly fallbackFile = process.env.GPS_FALLBACK_FILE ?? 'data/gps-fallback.jsonl';
  private readonly archiveFile = process.env.GPS_ARCHIVE_FILE ?? 'data/gps-archive.jsonl';
  private readonly retryDelayMs = 5000;
  private readonly jc = JSONCodec();

  private nc: NatsConnection | null = null;
  private isConnected = false;
  private isDraining = false;

  onApplicationBootstrap() {
    if (!this.natsUrl) {
      this.logger.warn(`NATS_URL is not set — GPS location events will be written to ${this.fallbackFile}`);
      return;
    }
    this.connectWithRetry();
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async connectWithRetry() {
    let attempt = 0;
    while (true) {
      attempt += 1;
      try {
        this.nc = await connect({
          servers: this.natsUrl,
          reconnect: true,
          maxReconnectAttempts: -1,
          reconnectTimeWait: this.retryDelayMs,
          waitOnFirstConnect: true,
          pingInterval: 20000,
        });
        this.logger.log(`Connected to ${this.natsUrl} (attempt ${attempt})`);
        this.isConnected = true;
        this.watchConnection();
        this.drainFallback();
        this.nc.closed().then((err) => {
          if (err) {
            this.logger.error(`Connection closed with error: ${(err as Error).message} — reconnecting`);
          } else {
            this.logger.warn('Connection closed — reconnecting');
          }
          this.nc = null;
          this.isConnected = false;
          this.connectWithRetry();
        });
        return;
      } catch (err) {
        this.logger.error(`Failed to connect (attempt ${attempt}): ${(err as Error).message} — retrying in ${this.retryDelayMs}ms`);
        await this.sleep(this.retryDelayMs);
      }
    }
  }

  private async watchConnection() {
    if (!this.nc) return;
    let lastStatus: string | null = null;
    try {
      for await (const status of this.nc.status()) {
        const key = `${status.type}:${status.data ?? ''}`;
        if (key !== lastStatus) {
          this.logger.log(`status: ${status.type}${status.data ? ` (${status.data})` : ''}`);
          lastStatus = key;
        }
        if (status.type === 'reconnect') {
          this.isConnected = true;
          this.drainFallback();
        } else if (status.type === 'disconnect' || status.type === 'reconnecting') {
          this.isConnected = false;
        }
      }
    } catch (err) {
      this.logger.error(`status iterator error: ${(err as Error).message}`);
    }
  }

  private async drainFallback() {
    if (this.isDraining) return;
    this.isDraining = true;
    const drainFile = `${this.fallbackFile}.draining`;
    try {
      try {
        await rename(this.fallbackFile, drainFile);
      } catch (err: any) {
        if (err.code === 'ENOENT') return;
        this.logger.error(`Failed to rotate fallback file: ${err.message}`);
        return;
      }

      const content = await readFile(drainFile, 'utf8');
      const lines = content.split('\n').filter(Boolean);
      this.logger.log(`Draining ${lines.length} buffered GPS event(s) from ${this.fallbackFile}`);

      const unsent: string[] = [];
      for (const line of lines) {
        if (!this.nc || this.nc.isClosed() || !this.isConnected) {
          unsent.push(line);
          continue;
        }
        try {
          const data = buildGpsData(JSON.parse(line));
          this.nc.publish('gps.location.received', this.jc.encode(data));
        } catch (err) {
          this.logger.error(`Drain publish failed: ${(err as Error).message}`);
          unsent.push(line);
        }
      }

      if (unsent.length > 0) {
        try {
          await appendFile(this.fallbackFile, unsent.join('\n') + '\n');
          this.logger.warn(`Re-buffered ${unsent.length} unsent event(s) to ${this.fallbackFile}`);
        } catch (err) {
          this.logger.error(`Failed to re-buffer unsent events: ${(err as Error).message}`);
        }
      } else {
        this.logger.log(`Drain complete — all ${lines.length} event(s) published`);
      }

      try {
        await unlink(drainFile);
      } catch (err) {
        this.logger.warn(`Failed to remove drain file: ${(err as Error).message}`);
      }
    } finally {
      this.isDraining = false;
    }
  }

  private async appendToArchive(data: GpsData) {
    try {
      await appendFile(this.archiveFile, JSON.stringify(data) + '\n');
    } catch (err) {
      this.logger.error(`Failed to write archive file ${this.archiveFile}: ${(err as Error).message}`);
    }
  }

  private async appendToFallback(data: GpsData, reason: string) {
    try {
      await appendFile(this.fallbackFile, JSON.stringify(data) + '\n');
      this.logger.warn(`${reason} — wrote GPS data to ${this.fallbackFile}`);
    } catch (err) {
      this.logger.error(`Failed to write fallback file ${this.fallbackFile}: ${(err as Error).message}`);
    }
  }

  publishGpsLocation(input: Record<string, any>, options: { archive?: boolean } = {}): GpsData {
    const { archive = true } = options;
    const data = buildGpsData(input);
    if (archive) this.appendToArchive(data);
    if (!this.nc || this.nc.isClosed() || !this.isConnected) {
      this.appendToFallback(data, 'Not connected');
      return data;
    }
    try {
      this.nc.publish('gps.location.received', this.jc.encode(data));
    } catch (err) {
      this.appendToFallback(data, `Publish failed: ${(err as Error).message}`);
    }
    return data;
  }
}
