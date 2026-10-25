import type { KitaAppApi } from '@binos/server/apps/kita/api'
import type { AgentId } from '@binos/server/services/kita/types'
import { hc } from 'hono/client'

const client = hc<KitaAppApi>(`${window.location.origin}/api/apps/kita`)
const conversations = client.conversations

const jsonHeaders = { headers: { 'Content-Type': 'application/json' } }

export async function listConversations() {
  const res = await conversations.$get()
  if (!res.ok) throw new Error(`读取对话失败（${res.status}）`)
  return (await res.json()).conversations
}

// 新对话返回它的 id；出错时返回给用户看的原因
export async function startConversation(text: string, temporary: boolean, agent: AgentId): Promise<{ id: string } | { error: string }> {
  const res = await conversations.$post({ json: { text, temporary, agent } }).catch(() => undefined)
  if (res?.status === 200) return await res.json()
  return { error: res?.status === 503 ? '消息没能发出，稍后再试' : `发送失败（${res?.status ?? '网络错误'}）` }
}

// 正在回答时交给 agent，它在下一步看到
export async function sendMessage(id: string, text: string): Promise<string | undefined> {
  const res = await conversations[':id'].messages.$post({ param: { id }, json: { text } }).catch(() => undefined)
  if (res?.status === 200) return undefined
  return res?.status === 503 ? '消息没能发出，稍后再试' : `发送失败（${res?.status ?? '网络错误'}）`
}

export async function stopConversation(id: string) {
  await conversations[':id'].stop.$post({ param: { id } }, jsonHeaders).catch(() => undefined)
}

export async function deleteConversation(id: string) {
  const res = await conversations[':id'].delete.$post({ param: { id } }, jsonHeaders).catch(() => undefined)
  return res?.ok ?? false
}
