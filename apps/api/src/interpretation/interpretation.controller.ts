import { CurrentUser } from '@nestjs/authentication';
import { Body, Controller, HttpCode, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes } from '@nestjs/swagger';
import {
  type TaskInterpretation,
  VOICE_MAX_BYTES,
  VOICE_MIME_TYPES,
  interpretRequestSchema,
  taskInterpretationSchema,
} from '@sibimate/shared';
import { ApiException } from '../common/api-exception.js';
import type { UserRow } from '../db/schema.js';
import { InterpretationService } from './interpretation.service.js';
import { ApiResult, UserAuth } from '../openapi/openapi.js';

/** The part of an uploaded file this controller reads. Uploads are kept in memory only. */
interface UploadedAudio {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
}

@UserAuth()
@Controller('tasks')
export class InterpretationController {
  constructor(private readonly interpretationService: InterpretationService) {}

  /**
   * Returns AI-written task details for the customer to accept or reject. Nothing is posted.
   * Send JSON `{ text }` for a typed task, or multipart form data with the recording in `audio`.
   */
  @Post('interpret')
  @ApiResult(taskInterpretationSchema)
  @ApiConsumes('application/json', 'multipart/form-data')
  @ApiBody({
    description: 'JSON with `text` for a typed task, or multipart form data with the recording in `audio`.',
    schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The task as the customer typed it' },
        audio: { type: 'string', format: 'binary', description: 'A recording: m4a, webm, ogg, wav or mp3' },
      },
    },
  })
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('audio', { limits: { fileSize: VOICE_MAX_BYTES, files: 1 } }))
  interpret(
    @CurrentUser() user: UserRow,
    @Body() body: unknown,
    @UploadedFile() audio?: UploadedAudio,
  ): Promise<TaskInterpretation> {
    if (audio) {
      // "audio/webm;codecs=opus" is audio/webm.
      const mimeType = audio.mimetype.split(';')[0]!.trim().toLowerCase();
      if (!VOICE_MIME_TYPES.some((allowed) => allowed === mimeType)) {
        throw invalid('audio', 'Send the recording as m4a, webm, ogg, wav or mp3.');
      }
      return this.interpretationService.interpretVoice(user, {
        audio: audio.buffer,
        mimeType,
        filename: audio.originalname || 'recording',
      });
    }

    const parsed = interpretRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw invalid('text', parsed.error.issues[0]?.message ?? 'Describe the task.');
    }
    return this.interpretationService.interpret(user, parsed.data.text);
  }
}

function invalid(path: string, message: string) {
  return new ApiException(400, 'validation_failed', 'Validation failed', [{ path, message }]);
}
