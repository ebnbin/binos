import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { connectedPreamble, keepAlive } from '../../sse.js'
import { monitor } from './monitor.js'
import type { MonitorStatus } from './types.js'

export const systemApi = new Hono()
  .use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store')
    await next()
  })
  .get('/status', (c) => c.json(monitor.status()))
  // 先给出现在的，之后每采样一次推送一次
  .get('/stream', (c) =>
    streamSSE(c, async (stream) => {
      const send = (status: MonitorStatus) => void stream.writeSSE({ data: JSON.stringify(status) })
      await stream.write(connectedPreamble)
      send(monitor.status())
      stream.onAbort(monitor.subscribe(send))
      await keepAlive(stream)
    }),
  )
  .post('/refresh', async (c) => {
    await monitor.refresh()
    return c.json(monitor.status())
  })
