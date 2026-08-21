export function createSlackService(token: string) {
    return {
        async post(options: {
            channel: string;
            message: string;
        }) {
            throw new Error('Slack service not implemented — use the fake in tests')
        }
    }
}