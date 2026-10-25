import { drivers } from './drivers/index.js'
import { createKitaSession, deleteKitaSession, getKitaSession, onKitaSessionEvent, ownedSessions, startSessions } from './sessions.js'
import type { KitaSessionOptions } from './sessions.js'
import type { KitaSessionEvent } from './types.js'
import type { AgentId } from './types.js'

// Kita 服务：任何 app 都可以建 session，和 agent 对话。agent 进程由服务管理，app 只管说话、停下、看内容
export { allLimits } from './limits.js'
export type { SendOptions, KitaSession, KitaSessionInput, KitaSessionOptions } from './sessions.js'
export type { Event, Item, Turn, SessionMetadata } from './journal.js'

export function forApp(owner: string) {
  if (!owner.trim()) throw new Error('Kita 需要调用方身份')
  return {
    createSession: (options: Omit<KitaSessionOptions, 'owner'>) => createKitaSession({ ...options, owner }),
    getSession: (id: string) => getKitaSession(id, owner),
    listSessions: () => ownedSessions(owner),
    deleteSession: (id: string) => deleteKitaSession(id, owner),
    onEvent: (listener: (id: string, event: KitaSessionEvent) => void) => onKitaSessionEvent(owner, listener),
  }
}

// 登录会随时间到期（比如快到期时自动换成备用 token），定时看一遍，变了就通知页面
const authCheckInterval = 3600_000

// 能按 API 价格折算花费：session 才有 costs
export const isPriced = (agent: AgentId) => Boolean(drivers[agent].cost)

export function startKitaService() {
  const check = () => {
    for (const driver of Object.values(drivers)) {
      driver.auth()
    }
  }
  check()
  setInterval(check, authCheckInterval).unref()
  startSessions()
}
