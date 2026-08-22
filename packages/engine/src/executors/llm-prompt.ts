import { z } from 'zod';
import { llmPrompt as llmPromptDef } from '@flow/core';
import type { Executor } from '../types';

type LlmParams = z.infer<typeof llmPromptDef.parameters>;

export const llmPromptExecutor: Executor<LlmParams> = async ({
  params,
  services,
}) => {
  const response = await services.llm.prompt(params);

  return {
    status: 'success',
    output: response,
    firedPorts: ['main'],
  };
};