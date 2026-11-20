import { Module } from '@nestjs/common';
import { ENV, type Env } from '../config/env.js';
import { InterpretationController } from './interpretation.controller.js';
import { InterpretationService } from './interpretation.service.js';
import { OpenAiTaskInterpreter } from './openai-task-interpreter.js';
import { OpenAiClient } from './openai.client.js';
import { OpenAiSpeechToText, SpeechToText, UnavailableSpeechToText } from './speech-to-text.js';
import { RuleBasedTaskInterpreter, TaskInterpreter, UnavailableTaskInterpreter } from './task-interpreter.js';

@Module({
  controllers: [InterpretationController],
  providers: [
    InterpretationService,
    {
      provide: TaskInterpreter,
      inject: [ENV],
      useFactory: (env: Env) => {
        if (env.TASK_INTERPRETER === 'openai') {
          return new OpenAiTaskInterpreter(new OpenAiClient({ apiKey: env.OPENAI_API_KEY! }), env.OPENAI_MODEL);
        }
        return env.TASK_INTERPRETER === 'rules' ? new RuleBasedTaskInterpreter() : new UnavailableTaskInterpreter();
      },
    },
    {
      provide: SpeechToText,
      inject: [ENV],
      useFactory: (env: Env) =>
        env.TASK_INTERPRETER === 'openai'
          ? new OpenAiSpeechToText(new OpenAiClient({ apiKey: env.OPENAI_API_KEY! }), env.OPENAI_TRANSCRIBE_MODEL)
          : new UnavailableSpeechToText(),
    },
  ],
  exports: [InterpretationService],
})
export class InterpretationModule {}
