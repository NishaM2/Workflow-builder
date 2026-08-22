import type { Executor } from "../types";
import { webhookTrigger } from "@flow/core";

export const webhookTriggerExecutor: Executor = async ({
    triggerPayload,
}) => {
    const parsed = webhookTrigger.output.safeParse(triggerPayload);

    if (!parsed.success) {
        return {
            status: 'error',
            error: {
            message: `Invalid webhook payload: ${parsed.error.issues
                .map(
                (issue) =>
                    `${issue.path.join('.') || 'root'} — ${issue.message}`
                )
                .join('; ')}`,
            code: 'INVALID_TRIGGER_PAYLOAD',
            },
        };
    }

    return {
        status: "success",
        output: parsed.data,
        firedPorts: ["main"],
    };
};