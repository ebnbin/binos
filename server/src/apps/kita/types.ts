import type { AgentId, KitaSessionState } from '../../services/kita/types.js'

// 发消息的请求体。temporary：新对话是临时的；agent：新对话用哪个，不给是默认的。已有的对话不看这两项
export type ConversationMessage = { text: string; temporary?: boolean; agent?: AgentId }

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
