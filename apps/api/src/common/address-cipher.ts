import { Inject, Injectable } from '@nestjs/common';
import { ENV, type Env } from '../config/env.js';
import { open, seal } from './secret-box.js';

/** Encrypts exact addresses before they reach the database. */
@Injectable()
export class AddressCipher {
  constructor(@Inject(ENV) private readonly env: Env) {}

  encrypt(address: string): string {
    return seal(this.env.ADDRESS_KEY, address);
  }

  decrypt(stored: string): string {
    return open(this.env.ADDRESS_KEY, stored);
  }
}
