import { REFERENCE_PATTERN } from "@flow/core";
import { WHOLE_REFERENCE_PATTERN } from "@flow/core";

export interface OutputLookup {
    has(nodeId: string): boolean;
    get(nodeId: string): unknown;
}

export interface ResolveError {
    nodeId: string
    reference: string
    segment?: string
    message: string
}

export type ResolveResult =
    |   {
            ok: true;
            value: unknown;
        }
    |   {
            ok: false;
            error: ResolveError;
        };

function stringifyValue(value: unknown): string {
    if (value === null) {
        return 'null';
    }

    if (typeof value === 'object') {
        try {
            return JSON.stringify(value);
        } catch {
            return '[unserializable]';
        }
    }

    return String(value);
}

function resolveReference(
    reference: string,
    outputs: OutputLookup
): ResolveResult {
    const parts = reference.split('.');
    const nodeId = parts[0]!;

    const output = outputs.get(nodeId);

    if (!outputs.has(nodeId)) {
        return {
            ok: false,
            error: {
                nodeId,
                reference,
                message: `Node '${nodeId}' has no successful output`,
            },
        };
    }

    let current: unknown = output;

    for (const segment of parts.slice(1)) {
        if (
            current === null ||
            (typeof current !== 'object' &&
                typeof current !== 'function')
        ) {
            return {
                ok: false,
                error: {
                    nodeId,
                    reference,
                    segment,
                    message: `Cannot access '${segment}' because the current value is not an object`,
                },
            };
        }

        if (!Object.prototype.hasOwnProperty.call(current, segment)) {
            return {
                ok: false,
                error: {
                    nodeId,
                    reference,
                    segment,
                    message: `Path segment '${segment}' does not exist`,
                },
            };
        }
        current = (current as Record<string, unknown>)[segment];
    }

    return {
        ok: true,
        value: current,
    };
}

export function resolveExpression(
    template: string,
    outputs: OutputLookup
): ResolveResult {
    const whole = template.trim().match(WHOLE_REFERENCE_PATTERN);

    if (whole) {
        return resolveReference(whole[1]!, outputs);
    }

    let result = '';
    let lastIndex = 0;
    let found = false;

    for (const match of template.matchAll(REFERENCE_PATTERN)) {
        found = true;

        const resolved = resolveReference(match[1]!, outputs);
        if (!resolved.ok) return resolved;

        result +=
            template.slice(lastIndex, match.index) +
            stringifyValue(resolved.value);

        lastIndex = match.index + match[0].length;
    }

    if (!found) return { ok: true, value: template };

    result += template.slice(lastIndex);

    return { ok: true, value: result };
}
