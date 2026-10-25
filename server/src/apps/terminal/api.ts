import { upgradeWebSocket } from '@hono/node-server'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { errorHandler, forbidden, notFound } from '../../errors.js'
import { isCrossSite } from '../../websocket-origin.js'
import { connectTerminal, parseMessage } from './connection.js'
import type { TerminalServerMessage } from './connection.js'
import { createSession, hasSession, listSessions, runTmux, tmux } from './sessions.js'
import { checkTerminals } from './watch.js'

type Connection = ReturnType<typeof connectTerminal>
const counts = new Map<string, number>()
const acquire = (id: string) => {
  const count = counts.get(id) ?? 0
  if (count >= 4) throw new Error('同一个终端最多同时连接 4 个页面')
  counts.set(id, count + 1)
  return () => {
    const remaining = (counts.get(id) ?? 1) - 1
    if (remaining) counts.set(id, remaining)
    else counts.delete(id)
  }
}

export const terminalApi = new Hono()
  // 终端操作的错误是给用户看的原因
  .onError(errorHandler([400, 'invalid-input']))
  .use(bodyLimit({ maxSize: 128 * 1024 }))
  .get('/', async (c) => c.json({ available: !!tmux, sessions: await listSessions() }))
  .post('/sessions', async (c) => {
    const session = await createSession()
    await checkTerminals()
    return c.json(session, 201)
  })
  .use('/sessions/:id/*', async (c, next) => {
    if (!(await hasSession(c.req.param('id')!))) throw notFound('终端会话已结束')
    await next()
  })
  .delete('/sessions/:id', async (c) => {
    const id = c.req.param('id')
    if (!(await hasSession(id))) throw notFound('终端会话已结束')
    await runTmux(['kill-session', '-t', id])
    await checkTerminals()
    return c.body(null, 204)
  })
  .get('/sessions/:id/socket', async (c, next) => {
    if (isCrossSite(c)) throw forbidden('不能从别的网站连接')
    return upgradeWebSocket(() => {
      let connection: Connection | undefined
      let release: (() => void) | undefined
      return {
        onOpen(_event, ws) {
          try {
            release = acquire(c.req.param('id'))
            connection = connectTerminal(
              c.req.param('id'),
              (message) => ws.send(JSON.stringify(message)),
              () => ws.close(),
            )
          } catch (error) {
            release?.()
            release = undefined
            ws.send(JSON.stringify({ type: 'error', message: String(error) } satisfies TerminalServerMessage))
            ws.close()
          }
        },
        onMessage(event, ws) {
          try {
            const message = typeof event.data === 'string' && parseMessage(JSON.parse(event.data))
            if (!message) return ws.close(1008, 'Invalid message')
            connection?.receive(message)
          } catch {
            ws.close(1008, 'Invalid message')
          }
        },
        onClose() {
          connection?.dispose()
          release?.()
          release = undefined
        },
        onError() {
          connection?.dispose()
          release?.()
          release = undefined
        },
      }
    })(c, next)
  })
