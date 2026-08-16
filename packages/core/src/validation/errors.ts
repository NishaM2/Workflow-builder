type ValidationCode = 
    | 'UNKNOWN_NODE_TYPE'
    | 'MISSING_PARAM'
    | 'INVALID_PARAM'
    | 'INVALID_REFERENCE'
    | 'UNKNOWN_NODE'
    | 'INVALID_EDGE'
    | 'CYCLE_DETECTED'
    | 'MISSING_TRIGGER'
    | 'MULTIPLE_TRIGGERS'
    | 'TRIGGER_HAS_INCOMING_EDGE'
    | 'INVALID_WORKFLOW'
    | 'INVALID_TYPE_VERSION'
    | 'UNRESOLVED_PLACEHOLDER'
    | 'UNREACHABLE_NODE';

type ValidationSeverity = 'error' | 'warning'

export type ValidationError = {
    code: ValidationCode
    message: string
    nodeId?: string
    path?: string
    severity: ValidationSeverity
}