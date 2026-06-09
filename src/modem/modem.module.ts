import { Module, forwardRef } from '@nestjs/common';
import { ModemService } from './modem.service';
import { SmsModule } from '../sms/sms.module';

@Module({
  imports: [forwardRef(() => SmsModule)],
  providers: [ModemService],
  exports: [ModemService],
})
export class ModemModule {}
