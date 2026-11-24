import type { AgentId } from '@binos/protocol/services/kita'

export type { Context, Tokens, AgentId, AgentModel, AgentCatalog, Attachment, ToolDetail, ToolKind, LineCount, BrowserOperation, WebLink, FileChange, Entry, Status, TaskProgress, Live, LiveEvent, KitaSessionEvent, KitaSessionState, KitaSessionSummary, QuotaWindow, Limits, ClaudeAuth, CodexAuth, AgentAuths, AgentAttention, AgentStatus, AccountDetail, AgentAccount, IdentityScope, MemoryKind, MemorySource, NewMemory, MemoryChange, Memory, Photo, Profile, Activity } from '@binos/protocol/services/kita'

// 能用的 agent 和显示的名字。怎么接入在服务端的 drivers/，按同样的 id 对应
export const agents = {
  claude: { name: 'Claude' },
  codex: { name: 'Codex' },
} as const satisfies Record<AgentId, { name: string }>
export const agentIds = Object.keys(agents) as AgentId[]
// 没选 agent 的新对话用它
export const defaultAgent: AgentId = 'claude'
