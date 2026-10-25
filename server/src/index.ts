import { WebSocketServer } from 'ws'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import type { Context } from 'hono'
import { downloadsRouter } from './apps/builds/install.js'
import { api, createApi } from './api.js'
import { errorHandler } from './errors.js'
import { apiSocketPath, codeDir, libraryDir, serverLockPath } from './paths.js'
import { previewProxy } from './previews.js'
import { acquireProcessLock } from './process.js'
import { serverPort } from './production.js'
import { serverApps } from './apps/index.js'
import { migrateAgentToKita } from './migrations/kita.js'
import { startLocalApi } from './local-api.js'
import { startKitaService } from './services/kita/index.js'

// 一个根目录的数据只能由一个后端读写：两个后端会同时跟进同一轮回答，重复写入记录
const holder = acquireProcessLock(serverLockPath)
if (holder) {
  throw new Error(`根目录 ${path.dirname(libraryDir)} 已有后端在运行（进程 ${holder.pid}）`)
}
migrateAgentToKita(path.dirname(libraryDir))
// 免 Cloudflare 凭证的 API 只挂在受文件权限保护的 socket 上，不经过预览转发。
const localServer = await startLocalApi(createApi(async (_c, next) => { await next() }).fetch, apiSocketPath)
console.log(`binOS 本机 API：${apiSocketPath}`)
let stopping = false
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    if (stopping) return
    stopping = true
    localServer.close()
    setTimeout(() => process.exit(0), 5000).unref()
    void Promise.allSettled(serverApps.map((app) => app.stop?.())).finally(() => process.exit(0))
  })
}
startKitaService()
for (const app of serverApps) {
  app.start?.()
}

const app = new Hono().onError(errorHandler()).use(downloadsRouter).use(previewProxy).route('/', api)

// 开发时页面由 Vite 提供，没有 web/dist
const webDist = path.join(codeDir, 'web', 'dist')
if (existsSync(webDist)) {
  // 文件名带内容哈希的资源可以长期缓存，index.html 每次都要重新取，才能拿到新版本
  const setCache = (file: string, c: Context) =>
    c.header('Cache-Control', file.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache')
  app.use('*', serveStatic({ root: webDist, onFound: setCache }))
  const index = serveStatic({ path: path.join(webDist, 'index.html'), onFound: setCache })
  app.use('*', (c, next) => (c.req.path.startsWith('/api/') ? next() : index(c, next)))
}

// 测试实例和预览由启动方给出端口，正式版用固定的端口
const port = Number(process.env.PORT ?? serverPort)
serve({ fetch: app.fetch, hostname: '127.0.0.1', port, websocket: { server: new WebSocketServer({ noServer: true, maxPayload: 128 * 1024 }) } }, (info) => {
  console.log(`binOS 后端已启动：http://127.0.0.1:${info.port}`)
})
