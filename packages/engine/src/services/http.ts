import type { Services } from '../types';
import { assertUrlAllowed, type UrlGuardOptions } from './ssrf';

const MAX_REDIRECTS = 5;
const MAX_BODY_BYTES = 5 * 1024 * 1024;

export class RequestTimeoutError extends Error {
    constructor(ms: number) {
        super(`Request timed out after ${ms}ms`);
        this.name = 'RequestTimeoutError';
    }
}

export function createHttpService(
    guardOptions: UrlGuardOptions = {},
): Services['http'] {
    return {
        async request(options) {
        const timeoutMs = options.timeout ?? 30000;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        try {
            let url = options.url;
            let method = options.method;
            let body = serializeBody(options.body);
            let headers = withContentType(options.headers, options.body);

            for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
                await assertUrlAllowed(url, guardOptions);

                const response = await fetch(url, {
                    method,
                    headers,
                    body,
                    redirect: 'manual',
                    signal: controller.signal,
                });

                const location = response.headers.get('location');

                if (isRedirect(response.status) && location) {
                    if (hop === MAX_REDIRECTS) {
                        throw new Error(`Too many redirects (${MAX_REDIRECTS})`);
                    }

                    url = new URL(location, url).toString();

                    // 303, and 301/302 on POST, become a bodyless GET.
                    if (response.status === 303 || (method !== 'GET' && response.status < 303)) {
                        method = 'GET';
                        body = undefined;
                        headers = stripContentHeaders(headers);
                    }
                    continue;
                }

                return {
                    status: response.status,
                    headers: Object.fromEntries(response.headers.entries()),
                    body: await readBody(response),
                };
            }
            throw new Error(`Too many redirects (${MAX_REDIRECTS})`);
        } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') {
                throw new RequestTimeoutError(timeoutMs);
            }
            throw error;
        } finally {
            clearTimeout(timer);
        }
        },
    };
}

const isRedirect = (status: number) =>
    status === 301 || status === 302 || status === 303 ||
    status === 307 || status === 308;

function serializeBody(body: unknown): string | undefined {
    if (body === undefined || body === null) return undefined;
    if (typeof body === 'string') return body;
    return JSON.stringify(body);
}

function withContentType(
    headers: Record<string, string> | undefined,
    body: unknown,
): Record<string, string> {
    const result = { ...(headers ?? {}) };
    const hasContentType = Object.keys(result).some(
        (key) => key.toLowerCase() === 'content-type',
    );

    if (!hasContentType && body !== undefined && typeof body !== 'string') {
        result['content-type'] = 'application/json';
    }
    return result;
}

function stripContentHeaders(headers: Record<string, string>) {
    return Object.fromEntries(
        Object.entries(headers).filter(
            ([key]) => !['content-type', 'content-length'].includes(key.toLowerCase()),
        ),
    );
}

async function readBody(response: Response): Promise<unknown> {
    const raw = await response.text();

    if (raw.length > MAX_BODY_BYTES) {
        return { truncated: true, body: raw.slice(0, MAX_BODY_BYTES) };
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('json')) return raw;

    try {
        return JSON.parse(raw);
    } catch {
        return raw;
    }
}