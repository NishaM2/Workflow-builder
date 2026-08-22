import { z } from 'zod';
import { httpRequest as httpRequestDef } from '@flow/core';
import type { Executor } from '../types';

type HttpParams = z.infer<typeof httpRequestDef.parameters>;

export const httpRequestExecutor: Executor<HttpParams> = async ({
    params,
    services,
}) => {
    const response = await services.http.request(params);

    return {
        status: 'success',
        output: response,
        firedPorts: ['main'],
    };
};