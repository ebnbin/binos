import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { badRequest, errorHandler } from '../../../../errors.js'
import { cancelClaudeLogin, finishClaudeLogin, startClaudeLogin } from './login.js'
import type { ClaudeLoginKind } from './login.js'

const loginBody = validator('json', (value) => {
  const kind = (value as { kind?: unknown } | null)?.kind
  if (kind !== 'login' && kind !== 'token') throw badRequest()
  return { kind: kind as ClaudeLoginKind }
})

const codeBody = validator('json', (value) => {
  const code = (value as { code?: unknown } | null)?.code
  if (typeof code !== 'string' || !/^[\w#.~-]{1,500}$/.test(code.trim())) throw badRequest('授权代码的格式不对')
  return { code }
})

// 在网页上登录 Claude（见 login.ts）：/api/kita/claude 下
export const claudeApi = new Hono()
  // 登录过程里的错误都是给用户看的原因
  .onError(errorHandler([502, 'unavailable']))
  // 开始登录，返回授权链接
  .post('/login', loginBody, async (c) => c.json(await startClaudeLogin(c.req.valid('json').kind), 200))
  // 贴回授权后的代码，完成登录
  .post('/login/:id', codeBody, async (c) => {
    await finishClaudeLogin(c.req.param('id'), c.req.valid('json').code)
    return c.json({ ok: true as const }, 200)
  })
  .post('/login/:id/cancel', (c) => {
    cancelClaudeLogin(c.req.param('id'))
    return c.json({ ok: true as const }, 200)
  })

export type ClaudeApi = typeof claudeApi
