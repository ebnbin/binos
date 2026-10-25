import { randomUUID } from 'node:crypto'
import { upgradeWebSocket } from '@hono/node-server'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { streamSSE } from 'hono/streaming'
import { isCrossSite } from '../../websocket-origin.js'
import { connectTerminal, parseMessage } from './connection.js'
import type { TerminalServerMessage, TerminalStreamMessage } from './connection.js'
import { createSession, hasSession, listSessions, runTmux, tmux } from './sessions.js'

type Connection = ReturnType<typeof connectTerminal>
const streams = new Map<string, Connection>()
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
  .onError((error, c) => c.json({ error: error.message }, 400))
  .use(bodyLimit({ maxSize: 128 * 1024 }))
  .get('/', async (c) => c.json({ available: !!tmux, sessions: await listSessions() }))
  .post('/sessions', async (c) => c.json(await createSession(), 201))
  .use('/sessions/:id/*', async (c, next) => {
    if (!(await hasSession(c.req.param('id')!))) return c.json({ error: '终端会话已结束' }, 404)
    await next()
  })
  .delete('/sessions/:id', async (c) => {
    const id = c.req.param('id')
    if (!(await hasSession(id))) return c.json({ error: '终端会话已结束' }, 404)
    await runTmux(['kill-session', '-t', id])
    return c.json({ ok: true })
  })
  .get('/sessions/:id/socket', async (c, next) => {
    if (isCrossSite(c)) return c.text('Forbidden', 403)
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
  // 旧版正式后端尚未支持 WebSocket 预览转发时，通过 SSE 和 POST 保持终端可用。
  .get('/sessions/:id/stream', (c) => {
    const release = acquire(c.req.param('id'))
    return streamSSE(c, async (stream) => {
      const token = randomUUID()
      let connection: Connection | undefined
      let finish: () => void = () => {}
      const done = new Promise<void>((resolve) => {
        finish = resolve
      })
      const dispose = () => {
        streams.delete(token)
        connection?.dispose()
        finish()
      }
      stream.onAbort(dispose)
      try {
        await stream.writeSSE({ data: JSON.stringify({ type: 'connection', id: token } satisfies TerminalStreamMessage) })
        connection = connectTerminal(
          c.req.param('id'),
          (message) => {
            void stream.writeSSE({ data: JSON.stringify(message) }).catch(dispose)
          },
          finish,
        )
        streams.set(token, connection)
        await done
      } catch (error) {
        await stream.writeSSE({ data: JSON.stringify({ type: 'error', message: String(error) } satisfies TerminalStreamMessage) }).catch(() => {})
      } finally {
        dispose()
        release()
      }
    })
  })
  .post('/connections/:token', async (c) => {
    const connection = streams.get(c.req.param('token'))
    if (!connection) return c.json({ error: '连接已断开' }, 404)
    const message = parseMessage(await c.req.json())
    if (!message) return c.json({ error: 'Invalid message' }, 400)
    connection.receive(message)
    return c.json({ ok: true })
  })
