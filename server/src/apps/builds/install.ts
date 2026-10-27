import { execFile } from 'node:child_process'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { promisify } from 'node:util'
import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'
import { isTestInstance } from '../../paths.js'
import { buildRequest } from './client.js'
import { resultsDir } from './config.js'
import { enrollmentApi } from './enrollment.js'
import { installationOrigin } from './origin.js'
import type { Build } from './types.js'
const exec = promisify(execFile)
const key = randomBytes(32)
const lifetime = 24 * 60 * 60_000
const idValid = (id: string) => /^[a-f0-9-]{36}$/.test(id)
const sign = (id: string, expires: string) => createHmac('sha256', key).update(`${id}/${expires}`).digest('base64url')
export function installToken(id: string, now = Date.now()) { const expires = String(now + lifetime); return `${expires}.${sign(id, expires)}` }
export function validInstallToken(id: string, token: string, now = Date.now()) {
  const match = /^(\d{13})\.([\w-]{43})$/.exec(token)
  if (!idValid(id) || !match || Number(match[1]) <= now || Number(match[1]) > now + lifetime) return false
  const expected = Buffer.from(sign(id, match[1])); const given = Buffer.from(match[2])
  return given.length === expected.length && timingSafeEqual(given, expected)
}
export { installationOrigin }
export async function installableBuild(id: string): Promise<{ build: Build; file: string } | undefined> {
  if (!idValid(id)) return
  const { builds, mode } = await buildRequest({ action: 'status' })
  const build = builds.find((b) => b.id === id && b.status === 'success')
  const ipa = build?.artifacts.find((a) => a.kind === 'install' && a.platform === 'ios')
  if (mode !== 'real' || !build || !ipa) return
  const file = path.join(resultsDir, id, 'outputs', ipa.name)
  if (!(await lstat(file).catch(() => undefined))?.isFile()) return
  return { build, file }
}
type Info = { bundleId: string; version: string; name: string }
const cache = new Map<string, Info>()
export async function ipaInfo(file: string): Promise<Info> {
  const cached = cache.get(file); if (cached) return cached
  const { stdout } = await exec('unzip', ['-Z1', file], { maxBuffer: 4 << 20, timeout: 15_000 })
  const entry = stdout.split('\n').find((line) => /^Payload\/[^/]+\.app\/Info\.plist$/.test(line))
  if (!entry) throw new Error('IPA 缺少 Info.plist')
  const { stdout: plist } = await exec('unzip', ['-p', file, entry], { encoding: 'buffer', maxBuffer: 1 << 20, timeout: 15_000 })
  const json = await new Promise<string>((resolve, reject) => {
    const child = execFile('plutil', ['-convert', 'json', '-o', '-', '-'], { timeout: 15_000, maxBuffer: 1 << 20 }, (e, output) => e ? reject(e) : resolve(output))
    child.stdin?.on('error', reject); child.stdin?.end(plist)
  })
  const values = JSON.parse(json) as Record<string, unknown>
  const text = (key: string) => typeof values[key] === 'string' ? values[key] as string : undefined
  const bundleId = text('CFBundleIdentifier'); const version = text('CFBundleVersion')
  if (!bundleId || !version) throw new Error('IPA 缺少应用标识或版本号')
  const info = { bundleId, version, name: text('CFBundleDisplayName') ?? text('CFBundleName') ?? bundleId }
  if (cache.size >= 100) cache.delete(cache.keys().next().value!)
  cache.set(file, info); return info
}
const xml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;')
// 标题带短提交号，安装提示里能分清同一个应用的不同构建。
export function manifest(ipaUrl: string, info: Info, commit: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>items</key><array><dict>
<key>assets</key><array><dict><key>kind</key><string>software-package</string><key>url</key><string>${xml(ipaUrl)}</string></dict></array>
<key>metadata</key><dict><key>bundle-identifier</key><string>${xml(info.bundleId)}</string><key>bundle-version</key><string>${xml(info.version)}</string><key>kind</key><string>software</string><key>title</key><string>${xml(`${info.name} ${commit.slice(0, 7)}`)}</string></dict>
</dict></array></dict></plist>`
}
// 系统安装服务没有浏览器登录状态；这里只接受按构建 ID 签名、24 小时内有效的令牌。
export const installationApi = new Hono()
  .use('*', async (c, next) => { c.header('Cache-Control', 'no-store'); c.header('Referrer-Policy', 'no-referrer'); await next() })
  .onError((_e, c) => c.notFound())
  .get('/:id/:token/:resource', async (c) => {
    const { id, token, resource } = c.req.param()
    if (!['manifest.plist', 'app.ipa'].includes(resource) || !validInstallToken(id, token)) return c.notFound()
    const item = await installableBuild(id)
    if (!item) return c.notFound()
    if (resource === 'manifest.plist') {
      const url = new URL(c.req.url)
      const origin = installationOrigin(c.req.url)
      const ipaUrl = `${origin}${url.pathname.replace(/manifest\.plist$/, 'app.ipa')}`
      c.header('Content-Type', 'application/xml; charset=utf-8')
      return c.body(manifest(ipaUrl, await ipaInfo(item.file), item.build.commit))
    }
    const size = (await lstat(item.file)).size
    const headers: Record<string, string> = { 'Content-Type': 'application/octet-stream', 'Content-Length': String(size), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'Accept-Ranges': 'bytes' }
    const range = c.req.header('Range')
    let start = 0; let end = size - 1
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range)
      if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416, headers: { ...headers, 'Content-Length': '0', 'Content-Range': `bytes */${size}` } })
      start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]))
      end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= size) return new Response(null, { status: 416, headers: { ...headers, 'Content-Length': '0', 'Content-Range': `bytes */${size}` } })
      headers['Content-Range'] = `bytes ${start}-${end}/${size}`
      headers['Content-Length'] = String(end - start + 1)
    }
    return new Response(c.req.method === 'HEAD' ? null : Readable.toWeb(createReadStream(item.file, { start, end })) as ReadableStream, { status: range ? 206 : 200, headers })
  })

installationApi.all('*', (c) => c.notFound())

const downloads = new Hono().route('/install', installationApi).route('/enroll', enrollmentApi).all('*', (c) => c.notFound())
// 独立分发域名只处理签名的下载和设备登记；其他路径不进入网页、普通 API 或预览代理。
export const downloadsRouter: MiddlewareHandler = async (c, next) => {
  const url = new URL(c.req.url)
  if (url.hostname === 'downloads.binos.app') return downloads.fetch(c.req.raw)
  if (isTestInstance && ['localhost', '127.0.0.1'].includes(url.hostname) && /^\/(install|enroll)(\/|$)/.test(url.pathname)) return downloads.fetch(c.req.raw)
  return next()
}
