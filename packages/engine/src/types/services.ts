export interface Services {
    http: {
        request(options: {
            url: string;
            method: string;
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
            maxTokens?: number;
        }): Promise<{
            text: string;
        }>;
    };

    slack: {
        post(options: {
            channel: string;
            message: string;
        }): Promise<{
            ok: boolean;
            ts: string;
        }>;
    };

    logger: {
        info(message: string, meta?: Record<string, unknown>): void;
        error(message: string, meta?: Record<string, unknown>): void;
    };

    clock: {
        now(): string;
        nowMs(): number;
        sleep(ms: number): Promise<void>;
    };
}