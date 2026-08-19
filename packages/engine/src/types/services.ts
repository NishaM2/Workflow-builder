export interface Services {
    http: {
        request(options: {
            url: string;
            method: 'GET' | 'POST' | 'PUT';
            headers?: Record<string, string>;
            body?: unknown;
            timeout?: number;
        }): Promise<{
            status: number;
            headers: Record<string, string>;
            body: unknown;
        }>;
    };

    llm: {
        prompt(options: {
            model: string;
            prompt: string;
        }): Promise<{
            text: string;
        }>;
    };

    slack: {
        post(options: {
            channel: string;
            text: string;
        }): Promise<{
            ok: boolean;
            messageId?: string;
        }>;
    };

    logger: {
        info(message: string, meta?: Record<string, unknown>): void;
        error(message: string, meta?: Record<string, unknown>): void;
    };

    clock: {
        now(): string;
        sleep(ms: number): Promise<void>;
    };
}