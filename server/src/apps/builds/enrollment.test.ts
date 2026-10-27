import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Hono } from 'hono'
import { afterAll, expect, it, vi } from 'vitest'
const fixture = vi.hoisted(() => ({ root: '' }))
vi.mock('./config.js', () => ({ get dataDir() { return fixture.root }, mock: true }))
vi.mock('../../paths.js', () => ({ isTestInstance: true }))
fixture.root = mkdtempSync(path.join(os.tmpdir(), 'binos-enroll-test-'))
const { enrollmentApi, enrollmentToken, validEnrollmentToken, parseDeviceReport, parseProfile, iosDevices } = await import('./enrollment.js')
const app = new Hono().route('/enroll', enrollmentApi)
afterAll(() => rmSync(fixture.root, { recursive: true, force: true }))
// 设备发来的 CMS 签名数据：二进制的签名信息包着明文的 plist
const report = (udid: string, product = 'iPhone19,4') => Buffer.concat([Buffer.from([0x30, 0x80, 0x06, 0x09, 0xff]), Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict><key>PRODUCT</key><string>${product}</string><key>UDID</key><string>${udid}</string><key>VERSION</key><string>24B119</string></dict></plist>`), Buffer.from([0x00, 0xa0, 0x82])])

it('登记令牌校验签名且 30 分钟后过期', () => {
  const now = 1_800_000_000_000; const token = enrollmentToken(now)
  expect(validEnrollmentToken(token, now)).toBe(true)
  expect(validEnrollmentToken(token, now + 30 * 60_000)).toBe(false)
  expect(validEnrollmentToken(token.replace(/.$/, token.endsWith('a') ? 'b' : 'a'), now)).toBe(false)
})
it('从签名数据里取出 UDID 和型号，拒绝格式不对的回传', () => {
  expect(parseDeviceReport(report('00008150-001a2b3c4d5e6f70'))).toEqual({ udid: '00008150-001A2B3C4D5E6F70', product: 'iPhone19,4', version: '24B119' })
  expect(parseDeviceReport(report('../../etc'))).toBeUndefined()
  expect(parseDeviceReport(report('00008150-001A2B3C4D5E6F70', '<script>'))).toBeUndefined()
  expect(parseDeviceReport(Buffer.from('not a plist'))).toBeUndefined()
})
it('下载描述文件、设备回传后跳到结果页，结果页的网址里没有 UDID；令牌无效时都是 404', async () => {
  const token = enrollmentToken()
  const profile = await app.request(`http://127.0.0.1:3000/enroll/${token}/binOS.mobileconfig`)
  expect(profile.headers.get('Content-Type')).toBe('application/x-apple-aspen-config')
  expect(await profile.text()).toContain(`<string>http://127.0.0.1:3000/enroll/${token}/device</string>`)
  const posted = await app.request(`http://127.0.0.1:3000/enroll/${token}/device`, { method: 'POST', body: report('00008150-001A2B3C4D5E6F70') })
  expect(posted.status).toBe(301)
  expect(posted.headers.get('Location')).toBe(`http://127.0.0.1:3000/enroll/${token}/done`)
  expect(await (await app.request(`http://127.0.0.1:3000/enroll/${token}/done`)).text()).toContain('00008150-001A2B3C4D5E6F70')
  expect((await iosDevices()).devices.map((device) => [device.udid, device.provisioned])).toEqual([['00008150-001A2B3C4D5E6F70', false]])
  for (const [url, method] of [[`/enroll/bad/binOS.mobileconfig`, 'GET'], [`/enroll/bad/device`, 'POST'], [`/enroll/${token}/other`, 'GET']]) expect((await app.request(`http://127.0.0.1:3000${url}`, { method, body: method === 'POST' ? report('00008150-001A2B3C4D5E6F70') : undefined })).status).toBe(404)
})
it('只认 app.binos 的 Ad Hoc 描述文件，取出其中登记的设备', () => {
  const profile = (identifier: string, debug: boolean) => `<plist><dict><key>CreationDate</key><date>2026-10-22T03:14:27Z</date><key>DeveloperCertificates</key><array><data>MIIF</data></array>
<key>Entitlements</key><dict><key>application-identifier</key><string>283WQYV2L9.${identifier}</string><key>get-task-allow</key><${debug}/></dict>
<key>ExpirationDate</key><date>2027-10-22T03:14:27Z</date><key>Name</key><string>iOS Team Ad Hoc Provisioning Profile: ${identifier}</string>
<key>ProvisionedDevices</key><array><string>00008150-001a2b3c4d5e6f70</string><string>00008140-0000000000000000</string></array></dict></plist>`
  expect(parseProfile(profile('app.binos', false))).toEqual({ name: 'iOS Team Ad Hoc Provisioning Profile: app.binos', expiresAt: '2027-10-22T03:14:27Z', created: Date.parse('2026-10-22T03:14:27Z'), devices: ['00008150-001A2B3C4D5E6F70', '00008140-0000000000000000'] })
  expect(parseProfile(profile('app.binos', true))).toBeUndefined()
  expect(parseProfile(profile('app.other', false))).toBeUndefined()
})
