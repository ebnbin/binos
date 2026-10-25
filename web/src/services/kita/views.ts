import type { AgentAttention, AgentAuths, AgentId, AgentStatus } from '@binos/server/services/kita/types'
import type { ComponentType } from 'react'
import type { Attention, AuthRow, LoginAction } from './auth.ts'
import { claudeView } from './claude/view.tsx'
import { codexView } from './codex/view.tsx'

// 一种 agent 在页面上独有的部分：登录提醒的说法、系统 app 里登录相关的几行、就地登录
export type AgentView<Auth> = {
  // 服务端给出的要处理的事怎么说
  attention(attention: AgentAttention, now: number): Attention
  authRows(auth: Auth | undefined, now: number): AuthRow[]
  loginActions(auth: Auth | undefined): LoginAction[]
  // fix 是 attention 或 loginActions 给的；onClose 关上（没完成时顺便取消这次登录）
  Login: ComponentType<{ fix: string; onClose: () => void }>
}

const views: { [K in AgentId]: AgentView<AgentAuths[K]> } = { claude: claudeView, codex: codexView }

// 各个 agent 的登录状况形状不同，取出来交给它自己的那一份
export function agentView(agent: AgentId, status: AgentStatus | undefined) {
  const view = views[agent] as AgentView<unknown>
  const auth = status?.auth[agent]
  const attention = status?.attention[agent]
  return {
    attention: (now: number) => (attention ? view.attention(attention, now) : undefined),
    authRows: (now: number) => view.authRows(auth, now),
    loginActions: () => view.loginActions(auth),
    Login: view.Login,
  }
}
