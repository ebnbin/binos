import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'
import { streamSSE } from 'hono/streaming'
import { validator } from 'hono/validator'
import { requireOwner } from './access.js'
import { ApiException, badRequest, errorHandler, notFound } from './errors.js'
import { serverApps } from './apps/index.js'
import { onChange } from './events.js'
import { kitaApi } from './services/kita/api.js'
import { codeDir } from './paths.js'
import { protocolId, schemaPath } from './protocol-id.js'
import { connectedPreamble, keepAlive } from './sse.js'
import { parseExternalApps, readRegistry, saveRegistry } from './registry.js'
import type { ChangeEvent, Health } from './types.js'

// VERSION 由上线脚本写进构建目录，开发时没有
const versionFile = path.join(codeDir, 'VERSION')
const version = existsSync(versionFile) ? readFileSync(versionFile, 'utf8').trim() : 'dev'
const protocol = protocolId(readFileSync(schemaPath, 'utf8'))

// 写操作只接受 JSON 和上传文件用的 octet-stream：浏览器跨站提交这两种都需要预检，其他网站无法借你的登录状态发起请求
const requirePreflight: MiddlewareHandler = async (c, next) => {
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD' && !/^application\/(json|octet-stream)(;|$)/.test(c.req.header('Content-Type') ?? '')) {
    throw new ApiException(415, 'unsupported-media-type', '写操作的请求体只能是 JSON 或文件本身')
  }
  await next()
}

const registryBody = validator('json', (value) => {
  const external = parseExternalApps((value as { external?: unknown } | null)?.external)
  if (!external) throw badRequest('外部 app 的清单无效')
  return { external }
})

export function createApi(authorize: MiddlewareHandler = requireOwner) {
  const api = new Hono()
    .basePath('/api')
    .onError(errorHandler())
    // 上线脚本在本机检查它，拿不到 Access 凭证，所以注册在身份校验之前
    .get('/health', (c) => c.json({ version, protocol } satisfies Health))
    .use(authorize, requirePreflight)
    // app 注册表：整份读取，整份替换
    .get('/apps', (c) => c.json(readRegistry()))
    .put('/apps', registryBody, (c) => {
      saveRegistry(c.req.valid('json'))
      return c.json({ ok: true as const }, 200)
    })
    .route('/kita', kitaApi)
    // 页面只连这一条全局通知；断线重连后页面会全部重新读取，这里不补发
    .get('/events', (c) =>
      streamSSE(c, async (stream) => {
        await stream.write(connectedPreamble)
        const send = (event: ChangeEvent) => void stream.writeSSE({ data: JSON.stringify(event) })
        stream.onAbort(onChange(send))
        await keepAlive(stream)
      }),
    )

  // app 的路由不在 AppType 里，页面用各个 app 自己导出的类型
  for (const app of serverApps) {
    api.route(`/apps/${app.id}`, app.api)
  }
  api.all('*', () => {
    throw notFound('没有这个接口')
  })

  return api
}

export const api = createApi()
export type AppType = typeof api
