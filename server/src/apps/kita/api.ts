import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { agentIds, defaultAgent } from '../../services/kita/types.js'
import type { AgentId } from '../../services/kita/types.js'
import { deleteConversation, kita, listConversations, sendMessage, startConversation, stopConversation } from './conversations.js'

const maxText = 100_000

const conversationParam = validator('param', (value: Record<string, string>, c) => {
  const id = value.id ?? ''
  return kita.getSession(id) ? { id } : c.text('Not Found', 404)
})

const isAgent = (value: unknown): value is AgentId => agentIds.includes(value as AgentId)

// temporary：新对话是临时的；agent：新对话用哪个，不给是默认的。已有的对话不看这两项
const messageBody = validator('json', (value, c) => {
  const body = value as { text?: unknown; temporary?: unknown; agent?: unknown } | null
  const text = typeof body?.text === 'string' ? body.text.trim() : ''
  if (!text || text.length > maxText || (body?.temporary !== undefined && typeof body.temporary !== 'boolean') || (body?.agent !== undefined && !isAgent(body.agent))) {
    return c.text('Bad Request', 400)
  }
  const message: { text: string; temporary?: boolean; agent?: AgentId } = {
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
    return id ? c.json({ id }, 200) : c.json({ error: 'unavailable' } as const, 503)
  })
  .post('/conversations/:id/messages', conversationParam, messageBody, async (c) => {
    const sent = await sendMessage(c.req.valid('param').id, c.req.valid('json').text)
    return sent ? c.json({ ok: true } as const, 200) : c.json({ error: 'unavailable' } as const, 503)
  })
  .post('/conversations/:id/stop', conversationParam, (c) => c.json({ ok: stopConversation(c.req.valid('param').id) }, 200))
  // 只能删没在回答的
  .post('/conversations/:id/delete', conversationParam, async (c) => {
    const deleted = await deleteConversation(c.req.valid('param').id)
    return deleted ? c.json({ ok: true } as const, 200) : c.json({ error: 'answering' } as const, 409)
  })

export type KitaAppApi = typeof kitaAppApi
