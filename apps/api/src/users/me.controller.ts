import { CurrentUser } from '@nestjs/authentication';
import { Body, Controller, Delete, Get, HttpCode, Patch } from '@nestjs/common';
import { type UpdateMe, type User, updateMeSchema } from '@sibimate/shared';
import type { UserRow } from '../db/schema.js';
import { AccountService } from './account.service.js';
import { UsersRepository, toUser } from './users.repository.js';

@Controller('me')
export class MeController {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly account: AccountService,
  ) {}

  @Get()
  me(@CurrentUser() user: UserRow): User {
    return toUser(user);
  }

  @Patch()
  async update(@CurrentUser() user: UserRow, @Body({ schema: updateMeSchema }) body: UpdateMe): Promise<User> {
    const updated = await this.usersRepository.update(user.id, body);
    return toUser(updated ?? user);
  }

  /** Deletes the account and the person's details. Refused while a task or job is still open. */
  @Delete()
  @HttpCode(204)
  async delete(@CurrentUser() user: UserRow): Promise<void> {
    await this.account.delete(user);
  }
}
