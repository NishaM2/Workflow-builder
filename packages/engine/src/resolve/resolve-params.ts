import type { NodeDefinition, ParameterValue } from '@flow/core';
import { resolveExpression } from './resolve-expression';

export interface ParamProblem {
    param: string;
    message: string;
}

export type ResolveParamsResult =
    |   {
            ok: true;
            params: unknown;
        }
    |   {
            ok: false;
            problems: ParamProblem[];
        };

export function resolveParams(
    definition: NodeDefinition,
    params: Record<string, ParameterValue>,
    outputs: ReadonlyMap<string, unknown>
): ResolveParamsResult {
    const problems: ParamProblem[] = [];

    const resolved: Record<string, unknown> = {};

    for (const [paramName, paramValue] of Object.entries(params)) {
        switch (paramValue.kind) {
            case 'literal': {
                // Literal values are passed through untouched.
                // We deliberately do NOT resolve {{...}} inside them.
                resolved[paramName] = paramValue.value;
                break;
            }

            case 'template': {
                const result = resolveExpression(
                    paramValue.template,
                    outputs
                );

                if (result.ok) {
                    resolved[paramName] = result.value;
                } else {
                    problems.push({
                        param: paramName,
                        message: result.error.message,
                    });
                }

                break;
            }

            case 'placeholder': {
                // Normally unreachable because the pre-flight
                // validation should block the run first.
                problems.push({
                    param: paramName,
                    message: `Parameter '${paramName}' contains an unresolved placeholder`,
                });

                break;
            }

            default: {
                const _exhaustive: never = paramValue;

                throw new Error(
                    `Unhandled parameter kind: ${JSON.stringify(
                        _exhaustive
                    )}`
                );
            }
        }
    }

    // Don't run Zod validation if expression resolution
    // already produced problems.
    if (problems.length > 0) {
        return {
            ok: false,
            problems,
        };
    }

    // Validate the final resolved values against
    // the node definition's parameter schema.
    const parsed = definition.parameters.safeParse(
        resolved
    );

    if (!parsed.success) {
        return {
            ok: false,
            problems: parsed.error.issues.map((issue) => ({
                param:
                    issue.path.length > 0
                        ? issue.path.join('.')
                        : 'unknown',
                message: issue.message,
            })),
        };
    }

    return {
        ok: true,
        params: parsed.data,
    };
}