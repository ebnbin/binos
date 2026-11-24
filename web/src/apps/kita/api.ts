import type { AgentId } from '@binos/protocol/services/kita'
import { errorMessage, request } from '../../api.ts'

export async function listConversations() {
  const res = await request('GET /api/apps/kita/conversations')
  if (!res.ok) throw new Error(`读取对话失败（${res.status}）`)
  return (await res.json()).conversations
}

// 新对话返回它的 id；出错时返回给用户看的原因
export async function startConversation(text: string, temporary: boolean, agent: AgentId): Promise<{ id: string } | { error: string }> {
  const res = await request('POST /api/apps/kita/conversations', { json: { text, temporary, agent } }).catch(() => undefined)
  if (res?.ok) return await res.json()
  return { error: await errorMessage(res, '发送失败') }
}

// 正在回答时交给 agent，它在下一步看到
export async function sendMessage(id: string, text: string): Promise<string | undefined> {
  const res = await request('POST /api/apps/kita/conversations/:id/messages', { params: { id }, json: { text } }).catch(() => undefined)
  if (res?.ok) return undefined
  return errorMessage(res, '发送失败')
}

export async function stopConversation(id: string) {
  await request('POST /api/apps/kita/conversations/:id/stop', { params: { id } }).catch(() => undefined)
}

export async function deleteConversation(id: string) {
  const res = await request('DELETE /api/apps/kita/conversations/:id', { params: { id } }).catch(() => undefined)
  return res?.ok ?? false
}
