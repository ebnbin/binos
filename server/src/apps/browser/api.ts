import { upgradeWebSocket } from '@hono/node-server'
import { Hono } from 'hono'
import { forbidden } from '../../errors.js'
import { isCrossSite } from '../../websocket-origin.js'
import { connectBrowser } from './session.js'
import type { BrowserClientMessage, BrowserServerMessage } from './protocol.js'
import { parseMessage } from './protocol.js'

export const browserApi = new Hono()
  .get('/socket', async (c, next) => {
    if (isCrossSite(c)) throw forbidden('不能从别的网站连接')
    return upgradeWebSocket(() => {
      let connection: Awaited<ReturnType<typeof connectBrowser>> | undefined
      let closed = false
      const pending: BrowserClientMessage[] = []
      return {
        async onOpen(_event, ws) {
          try {
            connection = await connectBrowser(c.req.query('session'), (message) => ws.send(JSON.stringify(message)), (code) => ws.close(code))
            if (closed) connection.dispose()
            else for (const message of pending.splice(0)) connection.receive(message)
          } catch (error) {
            if (!closed) {
              ws.send(JSON.stringify({ type: 'error', message: error instanceof Error ? error.message : String(error) } satisfies BrowserServerMessage))
              ws.close(1011)
            }
          }
        },
        onMessage(event, ws) {
          try {
            const message = typeof event.data === 'string' && parseMessage(JSON.parse(event.data))
            if (!message) return ws.close(1008, 'Invalid message')
            if (connection) connection.receive(message)
            else if (pending.length < 128) pending.push(message)
            else ws.close(1008, 'Too many messages')
          } catch {
            ws.close(1008, 'Invalid message')
          }
        },
        onClose() { closed = true; connection?.dispose() },
        onError() { closed = true; connection?.dispose() },
      }
    })(c, next)
  })
