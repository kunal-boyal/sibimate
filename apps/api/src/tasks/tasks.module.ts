import { Module } from '@nestjs/common';
import { AddressCipher } from '../common/address-cipher.js';
import { InterpretationModule } from '../interpretation/interpretation.module.js';
import { TaskStateService } from './task-state.service.js';
import { TasksController } from './tasks.controller.js';
import { TasksService } from './tasks.service.js';

@Module({
  imports: [InterpretationModule],
  controllers: [TasksController],
  providers: [TasksService, TaskStateService, AddressCipher],
  exports: [TaskStateService],
})
export class TasksModule {}
