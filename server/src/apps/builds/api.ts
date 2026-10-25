import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { lstat, open } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { createReadStream } from 'node:fs'
import { badRequest, errorHandler, notFound } from '../../errors.js'
import { buildRequest } from './client.js'
import { installableBuild, installationOrigin, installToken, ipaInfo } from './install.js'
import { resultsDir } from './config.js'
import { parseRequest } from './protocol.js'
import type { BuildEnqueue, BuildsSnapshot, InstallLink, Settings } from './types.js'
const idValid = (id: string) => /^[a-f0-9-]{36}$/.test(id)
const buildParam = validator('param', (value: Record<string, string>) => {
  if (!idValid(value.id ?? '')) throw notFound('构建不存在')
  return { id: value.id! }
})
const enqueueBody = validator('json', (value): BuildEnqueue => {
  try {
    const { ref, targets } = parseRequest({ ...(value as object), action: 'enqueue' }) as BuildEnqueue
    return { ref, targets }
  } catch {
    throw badRequest('构建来源要是 main、pr/编号 或完整的提交号，并选择构建目标')
  }
})
const settingsBody = validator('json', (value): Settings => {
  const automatic = (value as Partial<Settings> | null)?.automatic
  if (typeof automatic !== 'boolean') throw badRequest()
  return { automatic }
})
export const buildsApi = new Hono()
  .use('*', async (c, next) => { c.header('Cache-Control', 'no-store'); await next() })
  // 构建服务回复的错误是给用户看的原因
  .onError(errorHandler([409, 'conflict']))
  .get('/', async (c) => c.json(await buildRequest({ action: 'status' })))
  // 手动构建
  .post('/', enqueueBody, async (c) => c.json(await buildRequest({ action: 'enqueue', ...c.req.valid('json') })))
  // 现在就检查 main 和 PR 有没有新提交
  .post('/poll', async (c) => c.json(await buildRequest({ action: 'poll' })))
  .put('/settings', settingsBody, async (c) => c.json(await buildRequest({ action: 'settings', ...c.req.valid('json') })))
  .post('/:id/cancel', buildParam, async (c) => c.json(await buildRequest({ action: 'cancel', id: c.req.valid('param').id })))
  .post('/:id/retry', buildParam, async (c) => c.json(await buildRequest({ action: 'retry', id: c.req.valid('param').id })))
  .post('/:id/install', async (c) => {
    const item = await installableBuild(c.req.param('id'))
    if (!item) throw notFound('没有可安装的 iOS 包')
    const origin = installationOrigin(c.req.url)
    await ipaInfo(item.file)
    const token = installToken(item.build.id)
    const url = `${origin}/install/${item.build.id}/${token}/manifest.plist`
    const probe = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(10_000) }).catch(() => undefined)
    const ready = probe?.ok && (probe.headers.get('Content-Type') ?? '').includes('application/xml')
    await probe?.body?.cancel()
    if (!ready) throw new Error('安装入口尚未就绪：请确认此版本已上线，并且 downloads.binos.app 已连接 Tunnel 并配置独立的 Cloudflare Access Bypass 策略')
    return c.json({ url: `itms-services://?action=download-manifest&url=${encodeURIComponent(url)}`, expiresIn: 86400 } satisfies InstallLink)
  })
  .get('/:id/log', async (c) => {
    const id = c.req.param('id')
    if (!idValid(id)) throw notFound('构建不存在')
    if (c.req.query('download') === '1') {
      const file = path.join(resultsDir, id, 'build.log')
      if (!(await lstat(file).catch(() => undefined))?.isFile()) throw notFound('还没有日志')
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
    if (!idValid(id) || name.startsWith('.') || /[/\\]/.test(name)) throw notFound('产物不存在')
    const snapshot = await buildRequest<BuildsSnapshot>({ action: 'status' })
    const b = snapshot.builds.find((b) => b.id === id && b.status === 'success')
    if (!b?.artifacts.some((a) => a.kind === 'install' && a.name === name)) throw notFound('产物不存在')
    const file = path.join(resultsDir, id, 'outputs', name)
    if (!(await lstat(file).catch(() => undefined))?.isFile()) throw notFound('产物不存在')
    return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${name.replaceAll('"', '')}"`, 'Cache-Control': 'no-store' } })
  })
