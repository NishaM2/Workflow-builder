import { Services } from "../types"

export const consoleLogger: Services['logger'] = {
    info(message: string, meta?: Record<string, unknown>): void {
        console.log(message, meta ?? '')
    },

    error(message: string, meta?: Record<string, unknown>): void {
        console.error(message, meta ?? '');
    },
}

// Logs a failure that must not become a run failure. Recording and reporting are
// not the work, so a logger that throws is swallowed as well.
export function reportFailure(
    logger: Services['logger'],
    message: string,
    error: unknown,
    meta: Record<string, unknown> = {},
): void {
    try {
        logger.error(message, {
            ...meta,
            error: error instanceof Error ? error.message : String(error),
        });
    } catch {
        // Reporting a problem must not cause one.
    }
}
