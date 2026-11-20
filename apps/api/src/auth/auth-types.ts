import type { UserRow } from '../db/schema.js';

declare module '@nestjs/authentication' {
  interface AuthenticationTypes {
    user: UserRow;
  }
}
