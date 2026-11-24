import type { AgentId } from '../../contract.ts'

// 能用的 agent 和显示的名字
export const agents = {
  claude: { name: 'Claude' },
  codex: { name: 'Codex' },
} as const satisfies Record<AgentId, { name: string }>
export const agentIds = Object.keys(agents) as AgentId[]
// 没选 agent 的新对话用它，和后端的默认一致
export const defaultAgent: AgentId = 'claude'
