import { Module, forwardRef } from '@nestjs/common';
import { SmsService } from './sms.service';
import { SmsController } from './sms.controller';
import { NatsModule } from '../nats/nats.module';
import { ModemModule } from '../modem/modem.module';

@Module({
  imports: [NatsModule, forwardRef(() => ModemModule)],
  providers: [SmsService],
  controllers: [SmsController],
  exports: [SmsService],
})
export class SmsModule {}
