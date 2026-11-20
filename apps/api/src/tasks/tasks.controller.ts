import { CurrentUser } from '@nestjs/authentication';
import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  type ListTasksQuery,
  type Task,
  type TaskList,
  createTaskSchema,
  listTasksQuerySchema,
  type RetryTask,
  retryTaskSchema,
} from '@sibimate/shared';
import type { z } from 'zod';
import { ApiException } from '../common/api-exception.js';
import type { UserRow } from '../db/schema.js';
import { TasksService } from './tasks.service.js';

const notFound = () => new ApiException(404, 'not_found', 'Task not found.');

@Controller('tasks')
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  /** Posts a task. A retry with the same Idempotency-Key returns the task made the first time. */
  @Post()
  create(
    @CurrentUser() user: UserRow,
    @Body({ schema: createTaskSchema }) body: z.output<typeof createTaskSchema>,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<Task> {
    if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 128) {
      throw new ApiException(400, 'validation_failed', 'Validation failed', [
        { path: 'Idempotency-Key', message: 'Send an Idempotency-Key header of 8 to 128 characters.' },
      ]);
    }
    return this.tasksService.create(user, body, idempotencyKey);
  }

  @Get()
  list(
    @CurrentUser() user: UserRow,
    @Query({ schema: listTasksQuerySchema }) query: ListTasksQuery,
  ): Promise<TaskList> {
    return this.tasksService.list(user, query);
  }

  @Get(':id')
  get(
    @CurrentUser() user: UserRow,
    @Param('id', new ParseUUIDPipe({ exceptionFactory: notFound })) id: string,
  ): Promise<Task> {
    return this.tasksService.get(user, id);
  }

  @Post(':id/retry')
  @HttpCode(200)
  retry(
    @CurrentUser() user: UserRow,
    @Param('id', new ParseUUIDPipe({ exceptionFactory: notFound })) id: string,
    @Body({ schema: retryTaskSchema }) body: RetryTask,
  ): Promise<Task> {
    return this.tasksService.retry(user, id, body.customerPrice);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(
    @CurrentUser() user: UserRow,
    @Param('id', new ParseUUIDPipe({ exceptionFactory: notFound })) id: string,
  ): Promise<Task> {
    return this.tasksService.cancel(user, id);
  }
}
