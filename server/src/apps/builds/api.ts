import { Hono } from 'hono'
import { lstat, open } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { createReadStream } from 'node:fs'
import { buildRequest } from './client.js'
import { installableBuild, installationOrigin, installToken, ipaInfo } from './install.js'
import { resultsDir } from './config.js'
import { parseRequest } from './protocol.js'
import type { Snapshot } from './types.js'
const idValid = (id: string) => /^[a-f0-9-]{36}$/.test(id)
export const buildsApi = new Hono()
  .use('*', async (c, next) => { c.header('Cache-Control', 'no-store'); await next() })
  .onError((e, c) => c.json({ error: e.message }, 409))
  .get('/', async (c) => c.json(await buildRequest({ action: 'status' })))
  .post('/', async (c) => {
    const request = parseRequest(await c.req.json())
    if (request.action === 'stop' || request.action === 'handoff') return c.json({ error: '网页不能停止构建服务' }, 403)
    return c.json(await buildRequest(request))
  })
  .post('/:id/install', async (c) => {
    const item = await installableBuild(c.req.param('id'))
    if (!item) return c.notFound()
    const origin = installationOrigin(c.req.url)
    await ipaInfo(item.file)
    const token = installToken(item.build.id)
    const url = `${origin}/install/${item.build.id}/${token}/manifest.plist`
    const probe = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(10_000) }).catch(() => undefined)
    const ready = probe?.ok && (probe.headers.get('Content-Type') ?? '').includes('application/xml')
    await probe?.body?.cancel()
    if (!ready) throw new Error('安装入口尚未就绪：请确认此版本已上线，并且 downloads.binos.app 已连接 Tunnel 并配置独立的 Cloudflare Access Bypass 策略')
    return c.json({ url: `itms-services://?action=download-manifest&url=${encodeURIComponent(url)}`, expiresIn: 86400 })
  })
  .get('/:id/log', async (c) => {
    const id = c.req.param('id')
    if (!idValid(id)) return c.notFound()
    if (c.req.query('download') === '1') {
      const file = path.join(resultsDir, id, 'build.log')
      if (!(await lstat(file).catch(() => undefined))?.isFile()) return c.notFound()
      return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': 'attachment; filename=build.log', 'Cache-Control': 'no-store' } })
    }
    // 只读末尾 512 KiB，长构建日志不会耗尽后端内存。
    const file = await open(path.join(resultsDir, id, 'build.log'), 'r').catch(() => undefined)
    if (!file) return c.text('等待构建日志…')
    try { const size = (await file.stat()).size; const buffer = Buffer.alloc(Math.min(size, 512 * 1024)); await file.read(buffer, 0, buffer.length, Math.max(0, size - buffer.length)); return c.text((size > buffer.length ? '[仅显示日志末尾]\n' : '') + buffer.toString()) }
    finally { await file.close() }
  })
  .get('/:id/artifacts/:name', async (c) => {
    const id = c.req.param('id'); const name = c.req.param('name')
    if (!idValid(id) || name.startsWith('.') || /[/\\]/.test(name)) return c.notFound()
    const snapshot = await buildRequest<Snapshot>({ action: 'status' })
    const b = snapshot.builds.find((b) => b.id === id && b.status === 'success')
    if (!b?.artifacts.some((a) => a.name === name)) return c.notFound()
    const file = path.join(resultsDir, id, 'outputs', name)
    if (!(await lstat(file).catch(() => undefined))?.isFile()) return c.notFound()
    return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${name.replaceAll('"', '')}"`, 'Cache-Control': 'no-store' } })
  })
