import { execFile } from 'node:child_process'
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readdir, readFile, rename, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { Hono } from 'hono'
import { notifyChange } from '../../events.js'
import { dataDir, mock } from './config.js'
import { installationOrigin } from './origin.js'
import type { IosDevice, IosDevices } from './types.js'
const exec = promisify(execFile)
const devicesPath = () => path.join(dataDir, 'ios-devices.json')
const key = randomBytes(32)
const lifetime = 30 * 60_000
const sign = (expires: string) => createHmac('sha256', key).update(`enroll/${expires}`).digest('base64url')
export function enrollmentToken(now = Date.now()) { const expires = String(now + lifetime); return `${expires}.${sign(expires)}` }
export function validEnrollmentToken(token: string, now = Date.now()) {
  const match = /^(\d{13})\.([\w-]{43})$/.exec(token)
  if (!match || Number(match[1]) <= now || Number(match[1]) > now + lifetime) return false
  const expected = Buffer.from(sign(match[1])); const given = Buffer.from(match[2])
  return given.length === expected.length && timingSafeEqual(given, expected)
}

const xml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;')
// 描述文件服务：设备安装时把这些属性签名后发到 URL，系统里不留下描述文件
export function enrollmentProfile(reportUrl: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>PayloadContent</key><dict><key>URL</key><string>${xml(reportUrl)}</string><key>DeviceAttributes</key><array><string>UDID</string><string>PRODUCT</string><string>VERSION</string><string>DEVICE_NAME</string></array></dict>
<key>PayloadOrganization</key><string>binOS</string>
<key>PayloadDisplayName</key><string>binOS 设备登记</string>
<key>PayloadDescription</key><string>把这台设备的 UDID 发给 binOS，用来安装 binOS 的 iOS 测试版。安装后不会留下描述文件。</string>
<key>PayloadVersion</key><integer>1</integer>
<key>PayloadUUID</key><string>${randomUUID().toUpperCase()}</string>
<key>PayloadIdentifier</key><string>app.binos.enrollment</string>
<key>PayloadType</key><string>Profile Service</string>
</dict></plist>`
}
// 设备发来的是 CMS 签名的数据，其中的 plist 是明文
export function parseDeviceReport(body: Buffer) {
  const text = body.toString('latin1')
  const start = text.indexOf('<?xml'); const end = text.indexOf('</plist>', start)
  if (start < 0 || end < 0) return
  const plist = Buffer.from(text.slice(start, end + 8), 'latin1').toString('utf8')
  const values = Object.fromEntries([...plist.matchAll(/<key>(\w+)<\/key>\s*<string>([^<]*)<\/string>/g)].map((m) => [m[1], m[2].trim()]))
  if (!/^([0-9A-F]{8}-[0-9A-F]{16}|[0-9a-f]{40})$/i.test(values.UDID ?? '') || !/^[A-Za-z]+\d+,\d+$/.test(values.PRODUCT ?? '')) return
  return { udid: values.UDID.toUpperCase(), product: values.PRODUCT, ...(values.VERSION && { version: values.VERSION }), ...(values.DEVICE_NAME && { name: values.DEVICE_NAME }) }
}

// 型号标识对应的名称取自 Xcode 的模拟器机型描述
let models: Promise<Map<string, string>> | undefined
function modelNames() {
  models ??= (async () => {
    const names = new Map<string, string>()
    const root = '/Library/Developer/CoreSimulator/Profiles/DeviceTypes'
    for (const entry of await readdir(root).catch(() => [])) {
      if (!entry.endsWith('.simdevicetype')) continue
      const { stdout } = await exec('plutil', ['-convert', 'json', '-o', '-', path.join(root, entry, 'Contents', 'Resources', 'profile.plist')]).catch(() => ({ stdout: '{}' }))
      const profile = JSON.parse(stdout) as { modelIdentifier?: string; representedModelIdentifiers?: string[] }
      for (const id of [profile.modelIdentifier, ...(profile.representedModelIdentifiers ?? [])]) if (id && !names.has(id)) names.set(id, entry.replace(/\.simdevicetype$/, ''))
    }
    return names
  })()
  return models
}

// 描述文件里的日期和证书数据转不成 JSON，直接从 XML 里取需要的字段；只认 app.binos 的 Ad Hoc 描述文件
export function parseProfile(plist: string) {
  const value = (key: string, type: string) => new RegExp(`<key>${key}</key>\\s*<${type}>([^<]*)</${type}>`).exec(plist)?.[1]
  const name = value('Name', 'string'); const created = value('CreationDate', 'date'); const expiresAt = value('ExpirationDate', 'date')
  const devices = /<key>ProvisionedDevices<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(plist)?.[1]
  if (!name || !created || !expiresAt || !devices || !value('application-identifier', 'string')?.endsWith('.app.binos') || /<key>get-task-allow<\/key>\s*<true\/>/.test(plist)) return
  return { name, expiresAt, created: Date.parse(created), devices: [...devices.matchAll(/<string>([^<]+)<\/string>/g)].map((m) => m[1].toUpperCase()) }
}
// 本机最新的、还没过期的 app.binos Ad Hoc 描述文件；构建时 Xcode 会按开发者账号里登记的设备更新它
async function adHocProfile(now = Date.now()) {
  if (mock) return
  let best: { name: string; expiresAt: string; created: number; devices: string[] } | undefined
  for (const dir of [path.join(os.homedir(), 'Library', 'Developer', 'Xcode', 'UserData', 'Provisioning Profiles'), path.join(os.homedir(), 'Library', 'MobileDevice', 'Provisioning Profiles')]) {
    for (const entry of await readdir(dir).catch(() => [])) {
      if (!entry.endsWith('.mobileprovision')) continue
      try {
        const { stdout: plist } = await exec('security', ['cms', '-D', '-i', path.join(dir, entry)], { maxBuffer: 4 << 20 })
        const profile = parseProfile(plist)
        if (!profile || Date.parse(profile.expiresAt) <= now || (best && best.created >= profile.created)) continue
        best = profile
      } catch { /* 读不了的描述文件跳过 */ }
    }
  }
  return best
}

async function readDevices(): Promise<IosDevice[]> {
  if (!existsSync(devicesPath())) return []
  return JSON.parse(await readFile(devicesPath(), 'utf8')) as IosDevice[]
}
async function writeDevices(devices: IosDevice[]) {
  await writeFile(`${devicesPath()}.tmp`, JSON.stringify(devices, null, 2) + '\n', { mode: 0o600 })
  await rename(`${devicesPath()}.tmp`, devicesPath())
  notifyChange({ type: 'builds' })
}
export async function iosDevices(): Promise<IosDevices> {
  const [devices, profile] = await Promise.all([readDevices(), adHocProfile()])
  return {
    devices: devices.map((device) => ({ ...device, provisioned: Boolean(profile?.devices.includes(device.udid)) })),
    ...(profile && { profile: { name: profile.name, expiresAt: profile.expiresAt, devices: profile.devices.length } }),
  }
}
export async function enroll(report: NonNullable<ReturnType<typeof parseDeviceReport>>, now = new Date()) {
  const device: IosDevice = { ...report, model: (await modelNames()).get(report.product) ?? report.product, enrolledAt: now.toISOString() }
  await writeDevices([device, ...(await readDevices()).filter((item) => item.udid !== device.udid)])
  return device
}
export async function forget(udid: string) {
  await writeDevices((await readDevices()).filter((item) => item.udid !== udid))
}

// 安装描述文件后 Safari 打开结果页；令牌对应刚登记的设备，UDID 不出现在网址里
const reported = new Map<string, IosDevice>()
function resultPage(device: IosDevice | undefined) {
  const html = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
  const body = device ? `<h1>已获取设备的 UDID</h1>
<p class="device">${html(device.model)}${device.version ? ` · 系统 ${html(device.version)}` : ''}</p>
<div class="udid"><code id="udid">${html(device.udid)}</code><button id="copy" type="button">复制</button></div>
<ol>
<li>设备已经登记到 binOS，可以在「构建」页面看到。</li>
<li>在 Apple 开发者网站的 <a href="https://developer.apple.com/account/resources/devices/add">Devices</a> 里添加这个 UDID。</li>
<li>回到 <a href="https://binos.app">binOS</a> 重新构建一次 iOS，构建完成后在这台设备上安装。</li>
</ol>` : `<h1>链接已过期</h1><p>回到 <a href="https://binos.app">binOS</a> 的「构建」页面重新登记这台设备。</p>`
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>binOS 设备登记</title>
<style>
body{margin:0;padding:48px 24px;font:17px/1.5 -apple-system,system-ui,sans-serif;background:Canvas;color:CanvasText}
main{max-width:560px;margin:0 auto}
h1{font-size:28px;margin:0 0 8px}
.device{margin:0 0 24px;color:GrayText}
.udid{display:flex;gap:12px;align-items:center;padding:16px;border-radius:14px;background:color-mix(in srgb,CanvasText 6%,transparent)}
code{flex:1;font:15px ui-monospace,monospace;word-break:break-all}
button{font:inherit;font-size:15px;padding:8px 16px;border:0;border-radius:999px;background:#0088ff;color:#fff}
ol{padding-left:20px;margin:24px 0 0}li{margin:8px 0}
a{color:#0088ff}
</style></head><body><main>${body}</main>
<script>const b=document.getElementById('copy');b&&b.addEventListener('click',async()=>{await navigator.clipboard.writeText(document.getElementById('udid').textContent);b.textContent='已复制'})</script>
</body></html>`
}
// 设备的系统进程没有浏览器登录状态；这里只接受 30 分钟内签发的令牌
export const enrollmentApi = new Hono()
  .use('*', async (c, next) => { c.header('Cache-Control', 'no-store'); c.header('Referrer-Policy', 'no-referrer'); await next() })
  .onError((_e, c) => c.notFound())
  .get('/:token/binOS.mobileconfig', (c) => {
    const { token } = c.req.param()
    if (!validEnrollmentToken(token)) return c.notFound()
    c.header('Content-Type', 'application/x-apple-aspen-config')
    return c.body(enrollmentProfile(`${installationOrigin(c.req.url)}/enroll/${token}/device`))
  })
  .post('/:token/device', async (c) => {
    const { token } = c.req.param()
    const body = Buffer.from(await c.req.arrayBuffer())
    const report = validEnrollmentToken(token) && body.length < 64 * 1024 ? parseDeviceReport(body) : undefined
    if (!report) return c.notFound()
    reported.set(token, await enroll(report))
    setTimeout(() => reported.delete(token), lifetime).unref()
    return c.redirect(`${installationOrigin(c.req.url)}/enroll/${token}/done`, 301)
  })
  .get('/:token/done', (c) => {
    const { token } = c.req.param()
    c.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'")
    return c.html(resultPage(validEnrollmentToken(token) ? reported.get(token) : undefined))
  })
enrollmentApi.all('*', (c) => c.notFound())
