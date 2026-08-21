import { Services } from "../types";

export function createLlmService(apiKey: string): Services['llm'] {
    return {
        async prompt(options: {
            model: string;
            prompt: string;
            maxTokens?: number;
        })  {
        throw new Error('LLM service not implemented — use the fake in tests')
        }
    }
}