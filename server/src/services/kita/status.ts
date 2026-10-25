import { notifyChange } from '../../events.js'
import { drivers } from './drivers/index.js'
import { allLimits } from './limits.js'
import { agentIds } from './types.js'
import type { AgentStatus } from './types.js'

// setTimeout 最长能等这么久
const maxDelay = 2 ** 31 - 1
let timer: ReturnType<typeof setTimeout> | undefined

// 各个 agent 最近报告的额度和登录，以及登录要处理的事。到了结果会变的时候（比如该提醒快到期了）发 agent 通知，客户端重新读取
export function agentStatus(): AgentStatus {
  const now = Date.now()
  const status: AgentStatus = { limits: allLimits(), auth: {}, attention: {} }
  const changes: number[] = []
  for (const agent of agentIds) {
    const auth = drivers[agent].auth()
    const { attention, changesAt } = drivers[agent].attention(auth, now)
    Object.assign(status.auth, { [agent]: auth })
    if (attention) status.attention[agent] = attention
    if (changesAt) changes.push(changesAt)
  }
  clearTimeout(timer)
  if (changes.length) {
    timer = setTimeout(() => notifyChange({ type: 'agent' }), Math.min(Math.max(Math.min(...changes) - now, 0), maxDelay))
    timer.unref()
  }
  return status
}
