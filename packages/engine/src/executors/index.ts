import type { Executor } from '../types';
import {
  manualTrigger as manualTriggerDef,
  webhookTrigger as webhookTriggerDef,
  httpRequest as httpRequestDef,
  llmPrompt as llmPromptDef,
  slackPost as slackPostDef,
  logicIf as ifNodeDef,
} from '@flow/core';

import { manualTriggerExecutor } from './manual-trigger';
import { webhookTriggerExecutor } from './webhook-trigger';
import { httpRequestExecutor } from './http-request';
import { llmPromptExecutor } from './llm-prompt';
import { slackPostExecutor } from './slack-post';
import { logicIfExecutor } from './logic-if';

export const EXECUTORS: Record<string, Executor> = {
  [manualTriggerDef.id]: manualTriggerExecutor,
  [webhookTriggerDef.id]: webhookTriggerExecutor,
  [httpRequestDef.id]: httpRequestExecutor as Executor,
  [llmPromptDef.id]: llmPromptExecutor as Executor,
  [slackPostDef.id]: slackPostExecutor as Executor,
  [ifNodeDef.id]: logicIfExecutor as Executor,
};

export const getExecutor = (type: string): Executor | undefined => EXECUTORS[type];