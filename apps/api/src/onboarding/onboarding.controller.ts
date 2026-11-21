import { CurrentUser } from '@nestjs/authentication';
import { Body, Controller, Get, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  DOCUMENT_MAX_BYTES,
  DOCUMENT_MIME_TYPES,
  type HelperProfile,
  helperApplicationSchema,
  uploadDocumentSchema,
  helperProfileResponseSchema,
  helperProfileSchema,
  DOCUMENT_KINDS,
} from '@sibimate/shared';
import type { z } from 'zod';
import { ApiException } from '../common/api-exception.js';
import type { UserRow } from '../db/schema.js';
import { OnboardingService } from './onboarding.service.js';
import { ApiBody, ApiConsumes } from '@nestjs/swagger';
import { ApiResult, UserAuth } from '../openapi/openapi.js';

const invalid = (path: string, message: string) =>
  new ApiException(400, 'validation_failed', 'Validation failed', [{ path, message }]);

/** Becoming a helper. Open to every signed-in user: they are not a helper yet. */
@UserAuth()
@Controller('helper')
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Get('profile')
  @ApiResult(helperProfileResponseSchema)
  async profile(@CurrentUser() user: UserRow): Promise<{ profile: HelperProfile | null }> {
    return { profile: await this.onboarding.profile(user) };
  }

  @Post('profile')
  @ApiResult(helperProfileSchema, 201)
  apply(
    @CurrentUser() user: UserRow,
    @Body({ schema: helperApplicationSchema }) body: z.output<typeof helperApplicationSchema>,
  ): Promise<HelperProfile> {
    return this.onboarding.apply(user, body);
  }

  /** Multipart form data: `kind`, and the image in `file`. */
  @Post('documents')
  @ApiResult(helperProfileSchema, 201)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['kind', 'file'],
      properties: {
        kind: { type: 'string', enum: [...DOCUMENT_KINDS] },
        file: { type: 'string', format: 'binary', description: 'A JPEG, PNG or WebP photo' },
      },
    },
  })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: DOCUMENT_MAX_BYTES, files: 1 } }))
  upload(
    @CurrentUser() user: UserRow,
    @Body() body: unknown,
    @UploadedFile() file?: { buffer: Buffer; mimetype: string },
  ): Promise<HelperProfile> {
    const parsed = uploadDocumentSchema.safeParse(body);
    if (!parsed.success) {
      throw invalid('kind', 'Say which document this is.');
    }
    const contentType = DOCUMENT_MIME_TYPES.find((type) => type === file?.mimetype);
    if (!file || !contentType || !looksLikeImage(file.buffer, contentType)) {
      throw invalid('file', 'Send a photo as JPEG, PNG or WebP.');
    }
    return this.onboarding.upload(user, parsed.data.kind, { buffer: file.buffer, contentType });
  }
}

/** Checks the file's first bytes, so a file is not trusted on its label alone. */
function looksLikeImage(buffer: Buffer, contentType: string): boolean {
  const starts = (...bytes: number[]) => bytes.every((byte, index) => buffer[index] === byte);
  if (contentType === 'image/jpeg') {
    return starts(0xff, 0xd8, 0xff);
  }
  if (contentType === 'image/png') {
    return starts(0x89, 0x50, 0x4e, 0x47);
  }
  return buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP';
}
