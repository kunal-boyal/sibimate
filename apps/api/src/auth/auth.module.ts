import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module.js';
import './auth-types.js';
import { AuthController } from './auth.controller.js';
import { JwtAuth } from './jwt-auth.provider.js';
import { OtpService } from './otp.service.js';
import { DrizzleRefreshTokenStore } from './refresh-token.store.js';
import { ENV, type Env } from '../config/env.js';
import { ConsoleSmsSender, Msg91SmsSender, SmsSender } from './sms-sender.js';

@Module({
  imports: [UsersModule],
  controllers: [AuthController],
  providers: [
    JwtAuth,
    DrizzleRefreshTokenStore,
    OtpService,
    {
      provide: SmsSender,
      inject: [ENV],
      useFactory: (env: Env) => (env.SMS_PROVIDER === 'msg91' ? new Msg91SmsSender(env) : new ConsoleSmsSender()),
    },
  ],
})
export class AuthModule {}
