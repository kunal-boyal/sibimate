import { AuthenticationModule } from '@nestjs/authentication';
import { Module } from '@nestjs/common';
import { DrizzleModule } from '@nestjs/drizzle';
import { LocalDisk, S3Disk, StorageModule } from '@nestjs/storage';
import { drizzle } from 'drizzle-orm/node-postgres';
import { AdminModule } from './admin/admin.module.js';
import { AuthModule } from './auth/auth.module.js';
import { BookingsModule } from './bookings/bookings.module.js';
import { ENV, type Env, EnvModule } from './config/env.js';
import { schema } from './db/db.js';
import { HealthController } from './health/health.controller.js';
import { InterpretationModule } from './interpretation/interpretation.module.js';
import { MatchingQueueModule } from './matching/matching-queue.module.js';
import { MatchingModule } from './matching/matching.module.js';
import { OnboardingModule } from './onboarding/onboarding.module.js';
import { ReviewsController, ReviewsService } from './reviews/reviews.controller.js';
import { TasksModule } from './tasks/tasks.module.js';
import { UsersModule } from './users/users.module.js';

@Module({
  imports: [
    EnvModule,
    MatchingQueueModule.register(),
    DrizzleModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({ db: drizzle(env.DATABASE_URL, { schema }) }),
    }),
    AuthenticationModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        accessToken: {
          key: env.JWT_SECRET,
          issuer: 'https://api.sibimate.com',
          audience: 'sibimate-app',
          ttl: '15m',
        },
        refreshToken: { ttl: '30d', absoluteTtl: '90d' },
      }),
    }),
    StorageModule.forRootAsync({
      inject: [ENV],
      // Helpers' documents are private: they are read only through the API, by a verifier.
      useFactory: (env: Env) => ({
        default: 'documents',
        disks: {
          documents:
            env.STORAGE_DRIVER === 's3'
              ? new S3Disk({
                  bucket: env.S3_DOCUMENTS_BUCKET!,
                  region: env.S3_REGION,
                  serverSideEncryption: 'AES256',
                })
              : new LocalDisk({ root: `${env.STORAGE_ROOT}/documents` }),
        },
      }),
    }),
    UsersModule,
    AuthModule,
    InterpretationModule,
    TasksModule,
    BookingsModule,
    AdminModule,
    MatchingModule,
    OnboardingModule,
  ],
  controllers: [HealthController, ReviewsController],
  providers: [ReviewsService],
})
export class AppModule {}
