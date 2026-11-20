import { Module } from '@nestjs/common';
import { MeController } from './me.controller.js';
import { AddressCipher } from '../common/address-cipher.js';
import { AccountService } from './account.service.js';
import { UsersRepository } from './users.repository.js';

@Module({
  controllers: [MeController],
  providers: [UsersRepository, AccountService, AddressCipher],
  exports: [UsersRepository],
})
export class UsersModule {}
