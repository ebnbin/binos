import { Hono } from 'hono'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { afterAll, expect, it, vi } from 'vitest'
const fixture = vi.hoisted(() => ({ root: '', mode: 'real', builds: [] as unknown[] }))
vi.mock('./config.js', () => ({ resultsDir: fixture.root }))
vi.mock('./client.js', () => ({ buildRequest: async () => ({ mode: fixture.mode, builds: fixture.builds }) }))
vi.mock('../../paths.js', () => ({ isTestInstance: true }))
const root = mkdtempSync(path.join(os.tmpdir(), 'binos-ota-test-')); fixture.root = root
const { installationApi, installToken, validInstallToken, installationOrigin, downloadsRouter, ipaInfo, manifest } = await import('./install.js')
const id = '12345678-1234-1234-1234-123456789012'
const app = new Hono().route('/install', installationApi)
afterAll(() => rmSync(root, { recursive: true, force: true }))
it('安装令牌绑定构建 ID、校验签名且严格过期', () => {
  const now = 1_800_000_000_000; const token = installToken(id, now)
  expect(validInstallToken(id, token, now)).toBe(true)
  expect(validInstallToken('87654321-1234-1234-1234-123456789012', token, now)).toBe(false)
  expect(validInstallToken(id, token, now + 86400_000)).toBe(false)
  expect(validInstallToken(id, token.replace(/.$/, token.endsWith('a') ? 'b' : 'a'), now)).toBe(false)
  expect(validInstallToken('../secret', token, now)).toBe(false)
})
it('分发地址固定使用独立域名，隔离开发实例使用本机地址；清单转义 XML', () => {
  expect(installationOrigin('https://binos.app/api/apps/builds')).toBe('https://downloads.binos.app')
  expect(installationOrigin('https://pr-110.binos.app/api/apps/builds')).toBe('https://downloads.binos.app')
  expect(installationOrigin('https://evil.example/api/apps/builds')).toBe('https://downloads.binos.app')
  expect(installationOrigin('http://127.0.0.1:3000/api')).toBe('http://127.0.0.1:3000')
  expect(manifest('https://downloads.binos.app/a?b=1&c=2', { bundleId: 'app.binos', version: '3', name: '<binOS>' }, 'abcdef0123456789abcdef0123456789abcdef01')).toContain('<string>&lt;binOS&gt; abcdef0</string>')
})
it('独立域名不暴露普通页面、API 或预览；主域名不经过下载入口', async () => {
  const server = new Hono().use(downloadsRouter).get('*', (c) => c.text('主站'))
  for (const suffix of ['/', '/api/health', '/api/apps/builds', '/assets/main.js', '/install/invalid']) expect((await server.request('https://downloads.binos.app' + suffix)).status).toBe(404)
  expect(await (await server.request('https://binos.app/api/health')).text()).toBe('主站')
})
it('系统安装器无需浏览器凭据即可获取签名清单和 IPA，其他请求全部拒绝', async () => {
  const dir = path.join(root, id, 'outputs'); mkdirSync(dir, { recursive: true })
  const payload = path.join(root, 'pack/Payload/binOS.app'); mkdirSync(payload, { recursive: true })
  writeFileSync(path.join(payload, 'Info.plist'), '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>app.binos</string><key>CFBundleVersion</key><string>3</string><key>CFBundleName</key><string>binOS</string></dict></plist>')
  const ipa = path.join(dir, 'binos-ios-adhoc.ipa')
  execFileSync('ditto', ['-c', '-k', '--keepParent', path.join(root, 'pack/Payload'), ipa])
  expect(await ipaInfo(ipa)).toEqual({ bundleId: 'app.binos', version: '3', name: 'binOS' })
  fixture.builds = [{ id, commit: 'a'.repeat(40), target: 'ios-adhoc', status: 'success', artifacts: [{ name: 'binos-ios-adhoc.ipa', kind: 'install', platform: 'ios' }] }]
  const token = installToken(id)
  const prefix = `/install/${id}/${token}`
  const response = await app.request(`https://downloads.binos.app${prefix}/manifest.plist`)
  expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toBe('no-store')
  const content = await response.text(); expect(content).toContain('app.binos'); expect(content).toContain(`${prefix}/app.ipa`)
  const download = await app.request(`${prefix}/app.ipa`)
  expect(download.status).toBe(200); expect((await download.arrayBuffer()).byteLength).toBeGreaterThan(0)
  const partial = await app.request(`${prefix}/app.ipa`, { headers: { Range: 'bytes=0-9' } })
  expect(partial.status).toBe(206); expect((await partial.arrayBuffer()).byteLength).toBe(10)
  expect((await app.request(`${prefix}/app.ipa`, { headers: { Range: 'bytes=999999999-' } })).status).toBe(416)
  expect((await app.request('/install/not-found')).status).toBe(404)
  expect((await app.request(`${prefix}/other`)).status).toBe(404)
  expect((await app.request(`/install/${id}/invalid/app.ipa`)).status).toBe(404)
  fixture.builds = []; expect((await app.request(`${prefix}/app.ipa`)).status).toBe(404)
  fixture.mode = 'mock'; expect((await app.request(`${prefix}/app.ipa`)).status).toBe(404)
})
