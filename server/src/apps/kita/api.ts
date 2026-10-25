import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { ApiException, badRequest, notFound } from '../../errors.js'
import { agentIds, defaultAgent } from '../../services/kita/types.js'
import type { AgentId } from '../../services/kita/types.js'
import type { ConversationMessage } from './types.js'
import { deleteConversation, kita, listConversations, sendMessage, startConversation, stopConversation } from './conversations.js'

const maxText = 100_000

const conversationParam = validator('param', (value: Record<string, string>) => {
  const id = value.id ?? ''
  if (!kita.getSession(id)) throw notFound('对话不存在')
  return { id }
})

const unavailable = () => new ApiException(503, 'unavailable', '消息没能发出，稍后再试')

const isAgent = (value: unknown): value is AgentId => agentIds.includes(value as AgentId)

const messageBody = validator('json', (value) => {
  const body = value as { [K in keyof ConversationMessage]?: unknown } | null
  const text = typeof body?.text === 'string' ? body.text.trim() : ''
  if (!text || text.length > maxText || (body?.temporary !== undefined && typeof body.temporary !== 'boolean') || (body?.agent !== undefined && !isAgent(body.agent))) {
    throw badRequest('消息无效')
  }
  const message: ConversationMessage = {
    text,
    ...(body?.temporary === true && { temporary: true }),
    ...(isAgent(body?.agent) && { agent: body.agent }),
  }
  return message
})

export const kitaAppApi = new Hono()
  .get('/conversations', (c) => c.json({ conversations: listConversations() }))
  .post('/conversations', messageBody, async (c) => {
    const { text, temporary = false, agent = defaultAgent } = c.req.valid('json')
    const id = await startConversation(text, temporary, agent)
    if (!id) throw unavailable()
    return c.json({ id }, 200)
  })
  .post('/conversations/:id/messages', conversationParam, messageBody, async (c) => {
    const sent = await sendMessage(c.req.valid('param').id, c.req.valid('json').text)
    if (!sent) throw unavailable()
    return c.json({ ok: true } as const, 200)
  })
  .post('/conversations/:id/stop', conversationParam, (c) => c.json({ ok: stopConversation(c.req.valid('param').id) }, 200))
  // 只能删没在回答的
  .post('/conversations/:id/delete', conversationParam, async (c) => {
    const deleted = await deleteConversation(c.req.valid('param').id)
    if (!deleted) throw new ApiException(409, 'answering', '正在回答的对话不能删除')
    return c.json({ ok: true } as const, 200)
  })

export type KitaAppApi = typeof kitaAppApi
