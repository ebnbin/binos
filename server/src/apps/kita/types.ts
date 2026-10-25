import type { AgentId, KitaSessionState } from '../../services/kita/types.js'

// 喜多 app 里的一段对话，就是一个 Kita session。temporary：临时对话，不带喜多的身份，也读写不了记忆
export type Conversation = {
  id: string
  title: string
  temporary: boolean
  agent: AgentId
  state: KitaSessionState
  createdAt: string
  updatedAt: string
  outcome?: 'stopped' | 'error'
}
