import { getNodeDefinition } from "../catalog";
import { WorkflowSchema } from "../schemas";
import type { ValidationError } from "./errors";

export type ValidationResult = {
    valid: boolean;
    errors: ValidationError[]
    warnings: ValidationError[]
}

export const validationWorkflow = (workflow: unknown): ValidationResult => {
    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];

    // 1. Check basic workflow schema
    const result = WorkflowSchema.safeParse(workflow)

    if(!result.success) {
        errors.push({
            code: "INVALID_WORKFLOW",
            message: "Workflow schema isinvalid",
            severity: 'error',
        })

        return {
            valid: false,
            errors,
            warnings,
        }
    }

    const graph = result.data;

    // 2. Check node types
    for (const node of graph.nodes) {
        const definition = getNodeDefinition(node.type)

        if(!definition) {
            errors.push({
                code: "UNKNOWN_NODE_TYPE",
                message: `Unknown node type: ${node.type}`,
                nodeId: node.id,
                severity: "error",
            });
            continue
        }

        if (node.typeVersion !== definition.version) {
            errors.push({
                code: "INVALID_TYPE_VERSION",
                message: `Node ${node.type} uses version ${node.typeVersion}, but version ${definition.version} is available.`,
                nodeId: node.id,
                severity: "error",
            })
        }

        const shape = definition.parameters.shape

        for (const paramsName of Object.keys(shape)) {
            if(!(paramsName in node.params)) {
                errors.push({
                    code: "MISSING_PARAM",
                    message: `Missing parameter: ${paramsName}`,
                    nodeId: node.id,
                    path: paramsName,
                    severity: "error"
                })
            }
        }

        for (const paramsName of Object.keys(node.params)) {
            if(!(paramsName in shape)) {
                errors.push({
                    code: "INVALID_PARAM",
                    message: `Unknown parameter: ${paramsName}`,
                    nodeId: node.id,
                    path: paramsName,
                    severity: "error"
                })
            }
        }
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings,
    }

}