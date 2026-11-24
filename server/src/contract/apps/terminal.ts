export type TerminalSession = { id: string; created: number; cwd: string; command: string }
export type TerminalServerMessage = { type: 'output'; data: string } | { type: 'ready' | 'ping' | 'exit' } | { type: 'error'; message: string }
export type TerminalClientMessage = { type: 'input'; data: string } | { type: 'resize'; cols: number; rows: number } | { type: 'ack'; size: number } | { type: 'ping' }
