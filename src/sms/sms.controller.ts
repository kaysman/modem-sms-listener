import {
  Controller,
  Get,
  Post,
  Body,
  Req,
  Res,
  HttpCode,
  Query,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { readFile, appendFile } from 'fs/promises';
import { SmsService } from './sms.service';
import { NatsService } from '../nats/nats.service';
import { ModemService } from '../modem/modem.service';
import { SendSmsDto } from './dto/send-sms.dto';

const ARCHIVE_FILE = process.env.GPS_ARCHIVE_FILE ?? 'data/gps-archive.jsonl';
const SENT_FILE = process.env.SMS_SENT_FILE ?? 'data/sms-sent.jsonl';
const HISTORY_LIMIT = 200;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

@Controller()
export class SmsController {
  constructor(
    private readonly smsService: SmsService,
    private readonly natsService: NatsService,
    @Inject(forwardRef(() => ModemService)) private readonly modemService: ModemService,
  ) {}

  @Get('events')
  events(@Req() req: Request, @Res() res: Response) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    res.write('retry: 3000\n\n');
    for (const entry of this.smsService.getRecent()) {
      res.write(`data: ${JSON.stringify(entry)}\n\n`);
    }
    this.smsService.addSseClient(res);
    const keepalive = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        // connection already closed
      }
    }, 25000);
    req.on('close', () => {
      clearInterval(keepalive);
      this.smsService.removeSseClient(res);
    });
  }

  @Get('health')
  health(@Res() res: Response) {
    res.json({
      ok: true,
      port: this.modemService.getPort(),
      simNumber: this.smsService.getSimNumber(),
      sseClients: this.smsService.getSseClientCount(),
      buffered: this.smsService.getRecent().length,
    });
  }

  @Get('sms/inbox/archive')
  async archive(
    @Query('page') pageStr: string,
    @Query('pageSize') pageSizeStr: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Res() res: Response,
  ) {
    const page = Math.max(1, Number(pageStr) || 1);
    const requested = Number(pageSizeStr) || DEFAULT_PAGE_SIZE;
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, requested));
    const result = await this.readJsonlPage(ARCHIVE_FILE, page, pageSize, from || null, to || null);
    res.json(result);
  }

  @Get('sms/sent')
  async sent(@Res() res: Response) {
    const entries = await this.readJsonlTail(SENT_FILE, HISTORY_LIMIT);
    res.json(entries);
  }

  @Post('gps/replay')
  @HttpCode(200)
  async replay(@Res() res: Response) {
    try {
      const content = await readFile(ARCHIVE_FILE, 'utf8');
      const lines = content.split('\n').filter(Boolean);
      let published = 0;
      let failed = 0;
      for (const line of lines) {
        try {
          this.natsService.publishGpsLocation(JSON.parse(line), { archive: false });
          published += 1;
        } catch {
          failed += 1;
        }
      }
      res.json({ published, failed, total: lines.length });
    } catch (err: any) {
      if (err.code === 'ENOENT') return res.status(404).json({ error: 'archive file not found' });
      res.status(500).json({ error: err.message });
    }
  }

  @Post('sms/send')
  async send(@Body() body: SendSmsDto, @Res() res: Response) {
    const { to, message } = body;
    if (!to || !message) return res.status(400).json({ error: 'missing to/message' });
    const result = await this.modemService.sendSms(to, message);
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
        : (result.data?.response ??
            result.error?.message ??
            (result.error ? String(result.error) : null) ??
            JSON.stringify(result)),
    };
    await this.appendSentLog(entry);
    res.status(isOk ? 200 : 502).json({ ...result, entry });
  }

  private async readJsonlTail(filePath: string, limit: number) {
    try {
      const content = await readFile(filePath, 'utf8');
      const lines = content.split('\n').filter(Boolean).slice(-limit);
      const out = [];
      for (const line of lines) {
        try {
          out.push(JSON.parse(line));
        } catch {
          // skip malformed
        }
      }
      return out;
    } catch (err: any) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
  }

  private async readJsonlPage(
    filePath: string,
    page: number,
    pageSize: number,
    from: string | null,
    to: string | null,
  ) {
    try {
      const content = await readFile(filePath, 'utf8');
      const all = [];
      for (const line of content.split('\n')) {
        if (!line) continue;
        try {
          all.push(JSON.parse(line));
        } catch {
          // skip malformed
        }
      }
      let filtered = all;
      if (from || to) {
        const fromMs = from ? new Date(from).getTime() : -Infinity;
        const toMs = to
          ? to.includes('T')
            ? new Date(to).getTime()
            : new Date(to + 'T23:59:59.999').getTime()
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
    } catch (err: any) {
      if (err.code === 'ENOENT') return { entries: [], total: 0, page, pageSize };
      throw err;
    }
  }

  private async appendSentLog(entry: Record<string, any>) {
    try {
      await appendFile(SENT_FILE, JSON.stringify(entry) + '\n');
    } catch (err) {
      console.error(`[http] failed to append sent log: ${(err as Error).message}`);
    }
  }
}
