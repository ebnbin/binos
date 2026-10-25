import { Hono } from 'hono'
import { errorHandler } from '../../../../errors.js'
import { cancelCodexLogin, codexLoginStatus, startCodexLogin } from './login.js'

// 在网页上重新登录 Codex（设备码登录，见 login.ts）：/api/kita/codex 下
export const codexApi = new Hono()
  // 登录过程里的错误都是给用户看的原因
  .onError(errorHandler([502, 'unavailable']))
  // 开始登录，返回网址和一次性的码
  .post('/login', async (c) => c.json(await startCodexLogin(), 200))
  // 页面轮询：用户授权了没有
  .get('/login/:id', (c) => c.json(codexLoginStatus(c.req.param('id'))))
  // 放弃这次登录
  .delete('/login/:id', (c) => {
    cancelCodexLogin(c.req.param('id'))
    return c.body(null, 204)
  })

export type CodexApi = typeof codexApi
