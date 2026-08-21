import { Services } from "../types"

export const consoleLogger: Services['logger'] = {
    info(message: string, meta?: Record<string, unknown>): void {
        console.log(message, meta ?? '')
    },

    error(message: string, meta?: Record<string, unknown>): void {
        console.error(message, meta ?? '');
    },
}