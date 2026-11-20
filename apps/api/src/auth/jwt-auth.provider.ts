import { AuthenticationRegistry, JwtBearerProvider, type JwtClaims } from '@nestjs/authentication';
import { Injectable } from '@nestjs/common';
import type { UserRow } from '../db/schema.js';
import { UsersRepository } from '../users/users.repository.js';

/** Signs in a request from its bearer access token. */
@Injectable()
export class JwtAuth extends JwtBearerProvider<UserRow> {
  constructor(
    private readonly usersRepository: UsersRepository,
    registry: AuthenticationRegistry,
  ) {
    super({ realm: 'sibimate' });
    registry.registerProvider(this);
  }

  // Runs on every request, so a blocked or deleted account loses access at once.
  async validate({ sub }: JwtClaims) {
    const user = sub ? await this.usersRepository.findById(sub) : undefined;
    return user?.status === 'active' ? user : null;
  }
}
