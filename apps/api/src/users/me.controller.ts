import { CurrentUser } from '@nestjs/authentication';
import { Body, Controller, Get, Patch } from '@nestjs/common';
import { type UpdateMe, type User, updateMeSchema } from '@sibimate/shared';
import type { UserRow } from '../db/schema.js';
import { UsersRepository, toUser } from './users.repository.js';

@Controller('me')
export class MeController {
  constructor(private readonly usersRepository: UsersRepository) {}

  @Get()
  me(@CurrentUser() user: UserRow): User {
    return toUser(user);
  }

  @Patch()
  async update(@CurrentUser() user: UserRow, @Body({ schema: updateMeSchema }) body: UpdateMe): Promise<User> {
    const updated = await this.usersRepository.update(user.id, body);
    return toUser(updated ?? user);
  }
}
