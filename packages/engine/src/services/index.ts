import { Services } from "../types";
import { realClock } from "./clock";
import { createHttpService } from "./http";
import { createLlmService } from "./llm";
import { consoleLogger } from "./logger";
import { createSlackService } from "./slack";

export function createServices(): Services {
    const llmKey = process.env.LLM_API_KEY;
    const slackToken = process.env.SLACK_BOT_TOKEN;

    if (!llmKey) throw new Error('LLM_API_KEY is not set');
    if (!slackToken) throw new Error('SLACK_BOT_TOKEN is not set');

    return {
        http: createHttpService({
            allowPrivate: process.env.ALLOW_PRIVATE_NETWORK === 'true',
        }),
        llm: createLlmService(llmKey),
        slack: createSlackService(slackToken),
        logger: consoleLogger,
        clock: realClock,
    };
}