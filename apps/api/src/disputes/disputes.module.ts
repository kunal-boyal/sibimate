import { Module } from '@nestjs/common';
import { AddressCipher } from '../common/address-cipher.js';
import { TasksModule } from '../tasks/tasks.module.js';
import { DisputesController } from './disputes.controller.js';
import { DisputesService } from './disputes.service.js';

@Module({
  imports: [TasksModule],
  controllers: [DisputesController],
  providers: [DisputesService, AddressCipher],
  exports: [DisputesService],
})
export class DisputesModule {}
