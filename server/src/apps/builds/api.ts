import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { validator } from 'hono/validator'
import { lstat } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { createReadStream } from 'node:fs'
import { badRequest, errorHandler, notFound } from '../../errors.js'
import { buildRequest } from './client.js'
import { streamBuildLog } from './log.js'
import { enrollmentToken, forget, iosDevices } from './enrollment.js'
import { installableBuild, installationOrigin, installToken, ipaInfo } from './install.js'
import { resultsDir } from './config.js'
import { parseRequest } from './protocol.js'
import type { BuildEnqueue, BuildsSnapshot, EnrollmentLink, InstallLink, Settings } from './types.js'
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
  // 能无线安装 iOS 包的设备
  .get('/devices', async (c) => c.json(await iosDevices()))
  .post('/devices/enrollment', (c) => c.json({ url: `${installationOrigin(c.req.url)}/enroll/${enrollmentToken()}/binOS.mobileconfig`, expiresIn: 1800 } satisfies EnrollmentLink))
  // 只从 binOS 的列表里移除，开发者账号里登记的设备不变
  .delete('/devices/:udid', async (c) => { await forget(c.req.param('udid').toUpperCase()); return c.body(null, 204) })
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
  // 完整的日志，下载用
  .get('/:id/log', buildParam, async (c) => {
    const file = path.join(resultsDir, c.req.valid('param').id, 'build.log')
    if (!(await lstat(file).catch(() => undefined))?.isFile()) throw notFound('还没有日志')
    return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': 'attachment; filename=build.log', 'Cache-Control': 'no-store' } })
  })
  .get('/:id/log/stream', buildParam, async (c) => {
    const { id } = c.req.valid('param')
    if (!(await buildRequest({ action: 'status' })).builds.some((b) => b.id === id)) throw notFound('构建不存在')
    const from = Number(c.req.header('Last-Event-ID') ?? c.req.query('from') ?? NaN)
    return streamSSE(c, (stream) => streamBuildLog(stream, id, Number.isSafeInteger(from) && from >= 0 ? from : undefined))
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
