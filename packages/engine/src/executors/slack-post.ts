import { z } from 'zod';
import { slackPost as slackPostDef } from '@flow/core';
import type { Executor } from '../types';

type SlackParams = z.infer<typeof slackPostDef.parameters>;

export const slackPostExecutor: Executor<SlackParams> = async ({
  params,
  services,
}) => {
  const response = await services.slack.post(params);

  return {
    status: 'success',
    output: response,
    firedPorts: ['main'],
  };
};