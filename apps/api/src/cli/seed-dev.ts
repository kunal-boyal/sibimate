// Local development only: `pnpm --filter @sibimate/api db:seed`.
// Creates a dashboard admin and one helper, so a task can be run end to end on your own machine.
import { NestFactory } from '@nestjs/core';
import { AdminAuthService } from '../admin/admin-auth.service.js';
import { otpauthUri } from '../admin/totp.js';
import { AppModule } from '../app.module.js';
import { ENV, type Env } from '../config/env.js';
import { HelpersService } from '../helpers/helpers.service.js';

// These sign-in details are public in this file. They are refused outside development.
export const DEV_ADMIN = {
  email: 'admin@sibimate.test',
  password: 'sibimate-dev-admin',
  totpSecret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
} as const;
export const DEV_HELPER = { phone: '+919000000002', name: 'Aman (dev helper)' } as const;

const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
try {
  if (app.get<Env>(ENV).NODE_ENV !== 'development') {
    throw new Error('db:seed creates accounts with public passwords and only runs with NODE_ENV=development');
  }
  await app.get(AdminAuthService).upsertAdmin(DEV_ADMIN.email, DEV_ADMIN.password, 'owner', DEV_ADMIN.totpSecret);
  await app
    .get(HelpersService)
    .create({ ...DEV_HELPER, skillTag: 'unskilled', skills: [], verificationLevel: 'verified' });
  console.log(`Dashboard admin: ${DEV_ADMIN.email} (password and authenticator secret are in src/cli/seed-dev.ts)`);
  console.log(`Authenticator: ${otpauthUri(DEV_ADMIN.totpSecret, DEV_ADMIN.email)}`);
  console.log(`Helper: sign in to the app with ${DEV_HELPER.phone} and switch to Earn`);
} finally {
  await app.close();
}
