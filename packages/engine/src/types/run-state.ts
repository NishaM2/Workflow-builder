export type NodeState = 
    | 'pending'
    | 'running'
    | 'success'
    | 'error'
    | 'skipped'

export type EdgeState = 
    | 'pending'
    | 'active'
    | 'dead'

export type RunStatus = 
    | 'running'
    | 'success'
    | 'error'
    | 'blocked'

export type TerminalRunStatus = Exclude<RunStatus, 'running'>;