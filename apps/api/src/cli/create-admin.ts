// Creates a dashboard admin, or resets one's password and authenticator:
//   pnpm --filter @sibimate/api admin:create you@example.com owner
// The password is typed at the prompt and is never an argument, so it stays out of shell history.
import { createInterface } from 'node:readline/promises';
import { NestFactory } from '@nestjs/core';
import { ADMIN_ROLES, type AdminRole } from '@sibimate/shared';
import { AdminAuthService } from '../admin/admin-auth.service.js';
import { AppModule } from '../app.module.js';

const [email, role = 'owner'] = process.argv.slice(2);
if (!email || !/^\S+@\S+\.\S+$/.test(email) || !ADMIN_ROLES.includes(role as AdminRole)) {
  console.error(`Usage: admin:create <email> [${ADMIN_ROLES.join('|')}]`);
  process.exit(1);
}

const prompt = createInterface({ input: process.stdin, output: process.stdout });
const password = await prompt.question('Password (at least 12 characters): ');
prompt.close();
if (password.length < 12) {
  console.error('The password must be at least 12 characters.');
  process.exit(1);
}

const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
try {
  const { otpauthUri } = await app.get(AdminAuthService).upsertAdmin(email, password, role as AdminRole);
  console.log(`\nAdmin ${email} saved with the ${role} role.`);
  console.log('Add this to an authenticator app now. It is not shown again:');
  console.log(otpauthUri);
} finally {
  await app.close();
}
