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
    | 'success'
    | 'error'
    | 'blocked'