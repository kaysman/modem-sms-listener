import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { NatsModule } from './nats/nats.module';
import { SmsModule } from './sms/sms.module';
import { ModemModule } from './modem/modem.module';

@Module({
  imports: [
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'web'),
      exclude: ['/events', '/health', '/sms/(.*)', '/gps/(.*)'],
    }),
    NatsModule,
    SmsModule,
    ModemModule,
  ],
})
export class AppModule {}
