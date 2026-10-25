import { once } from 'node:events'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { serve, upgradeWebSocket } from '@hono/node-server'
import { Hono } from 'hono'
import WebSocket, { WebSocketServer } from 'ws'
import { afterAll, expect, it, vi } from 'vitest'

const root = mkdtempSync(path.join(os.tmpdir(), 'binos-preview-ws-'))
vi.mock('./paths.js', () => ({
  isTestInstance: false,
  get previewsDir() {
    return root
  },
}))
vi.mock('./access.js', () => ({
  requireOwner: async (c: any, next: () => Promise<void>) => (c.req.header('x-test-owner') === '1' ? next() : c.text('Unauthorized', 401)),
}))
const { previewProxy } = await import('./previews.js')

const upstreamApp = new Hono().get(
  '/socket',
  upgradeWebSocket((c) => ({
    onMessage(event, ws) {
      ws.send(`${c.req.header('origin')}|${c.req.header('host')}|${event.data}`)
    },
  })),
)
const upstream = serve({ fetch: upstreamApp.fetch, hostname: '127.0.0.1', port: 0, websocket: { server: new WebSocketServer({ noServer: true }) } })
await once(upstream, 'listening')
const port = (upstream.address() as { port: number }).port
mkdirSync(path.join(root, 'pr-1'))
writeFileSync(path.join(root, 'pr-1', 'preview.json'), JSON.stringify({ port }))
const front = serve({
  fetch: new Hono().use(previewProxy).fetch,
  hostname: '127.0.0.1',
  port: 0,
  websocket: { server: new WebSocketServer({ noServer: true }) },
})
await once(front, 'listening')
const frontPort = (front.address() as { port: number }).port

afterAll(async () => {
  await Promise.all([new Promise<void>((resolve) => front.close(() => resolve())), new Promise<void>((resolve) => upstream.close(() => resolve()))])
  rmSync(root, { recursive: true, force: true })
})

it('预览 WebSocket 经过身份校验并双向转发，保留公开域名和 Origin', async () => {
  const ws = new WebSocket(`ws://127.0.0.1:${frontPort}/socket`, { headers: { host: 'pr-1.binos.app', origin: 'https://pr-1.binos.app', 'x-test-owner': '1' } })
  await once(ws, 'open')
  const reply = once(ws, 'message')
  ws.send('input')
  const [data] = await reply
  expect(data.toString()).toBe('https://pr-1.binos.app|pr-1.binos.app|input')
  ws.close()
  await once(ws, 'close')
})

it('不带 Origin 的原生客户端经过身份校验后转发，转发时也不带 Origin', async () => {
  const ws = new WebSocket(`ws://127.0.0.1:${frontPort}/socket`, { headers: { host: 'pr-1.binos.app', 'x-test-owner': '1' } })
  await once(ws, 'open')
  const reply = once(ws, 'message')
  ws.send('input')
  const [data] = await reply
  expect(data.toString()).toBe('undefined|pr-1.binos.app|input')
  ws.close()
  await once(ws, 'close')
})

it('在升级连接前拒绝未登录或跨站请求', async () => {
  for (const [owner, origin, status] of [
    ['0', 'https://pr-1.binos.app', 401],
    ['0', undefined, 401],
    ['1', 'https://other.example', 403],
    ['1', 'null', 403],
  ] as const) {
    const ws = new WebSocket(`ws://127.0.0.1:${frontPort}/socket`, { headers: { host: 'pr-1.binos.app', ...(origin && { origin }), 'x-test-owner': owner } })
    const response = await new Promise<number>((resolve, reject) => {
      ws.on('unexpected-response', (_request, reply) => {
        reply.resume()
        ws.terminate()
        resolve(reply.statusCode!)
      })
      ws.on('error', (error) => {
        if (!error.message.includes('before the connection')) reject(error)
      })
    })
    expect(response).toBe(status)
  }
})
