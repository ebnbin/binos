import { createHash } from 'node:crypto'
import { execFile, spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { closeSync, existsSync, openSync } from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { setTimeout as sleep } from 'node:timers/promises'
import { isRunning, processStartTime } from '../../process.js'
import type { ProcessIdentity } from '../../process.js'
import { adb, avdDir, emulator, emulatorHome, iosSet, javaHome, mode, sdkDir, toolEnv } from './config.js'
import { iosModel, iosModels, iosProfile } from './ios-profile.js'
import type { IosRuntime } from './ios-profile.js'
import type { Device, DeviceModel, Models, ObservedDevice } from './types.js'

const exec = promisify(execFile)
export async function tool(command: string, args: string[], timeout = 30_000) {
  const { stdout } = await exec(command, args, { env: toolEnv, timeout, maxBuffer: 24 * 1024 * 1024 })
  return stdout.trim()
}
const sim = (args: string[], timeout?: number) => tool('xcrun', ['simctl', '--set', iosSet, ...args], timeout)
type SimDevice = { udid: string; name: string; state: string; isAvailable?: boolean; runtime?: string; deviceTypeIdentifier?: string }
const parseIos = (text: string) => Object.entries((JSON.parse(text) as { devices: Record<string, SimDevice[]> }).devices).flatMap(([runtime, devices]) => devices.map((device) => ({ ...device, runtime })))

export async function discover(): Promise<{ observed: ObservedDevice[]; discoveryErrors: string[] }> {
  if (mode === 'mock') return { observed: [], discoveryErrors: [] }
  const sources = await Promise.allSettled([
    tool('xcrun', ['simctl', 'list', 'devices', 'available', '--json']).then((text) => parseIos(text).map((d) => ({ platform: 'ios' as const, name: d.name, target: d.udid, state: d.state }))),
    tool(adb, ['devices']).then(async (text) => Promise.all(text.split('\n').slice(1).filter((line) => /^emulator-\d+\s+device/.test(line)).map(async (line) => {
      const target = line.split(/\s/)[0]
      const name = (await tool(adb, ['-s', target, 'emu', 'avd', 'name'])).split(/\r?\n/)[0].trim()
      return { platform: 'android' as const, name, target, state: 'Booted' }
    }))),
  ])
  return {
    observed: sources.flatMap<ObservedDevice>((result) => result.status === 'fulfilled' ? result.value : []),
    discoveryErrors: sources.flatMap((result, index) => result.status === 'rejected' ? [`${index === 0 ? 'iOS' : 'Android'} 查询失败：${message(result.reason)}`] : []),
  }
}
const mockModels: DeviceModel[] = [
  { platform: 'ios', id: 'mock-iphone', name: 'iPhone', family: 'iPhone', systems: ['preview'], default: true },
  { platform: 'ios', id: 'mock-ipad', name: 'iPad', family: 'iPad', systems: ['preview'] },
]
export async function models(): Promise<DeviceModel[]> {
  if (mode === 'mock') return mockModels
  const installed = JSON.parse(await tool('xcrun', ['simctl', 'list', 'runtimes', '--json'])) as { runtimes: IosRuntime[] }
  return iosModels(installed.runtimes, process.env.BINOS_IOS_DEVICE_TYPE, process.env.BINOS_IOS_RUNTIME)
}
// 把申请里的机型名称换成标识，本机没有的机型直接报错
export async function resolveModels(requested: Models): Promise<Models> {
  if (requested.android) throw new Error('Android 暂不支持指定机型')
  if (!requested.ios) return requested
  return { ios: iosModel(await models(), requested.ios).id }
}
export const message = (error: unknown) => error instanceof Error ? error.message.slice(0, 600) : String(error).slice(0, 600)

class OwnershipError extends Error {}
async function ownedAndroid(device: Device) {
  const name = (await tool(adb, ['-s', device.target, 'emu', 'avd', 'name'])).split(/\r?\n/)[0].trim()
  if (!name || name === 'OK' || name.startsWith('KO:')) throw new Error('模拟器正在切换状态，暂时无法核对名称')
  if (name !== device.name) throw new OwnershipError('设备端口由其他模拟器使用，已拒绝操作')
}
export async function health(device: Device) {
  if (mode === 'mock') return
  if (device.platform === 'android') {
    await ownedAndroid(device)
    if (await tool(adb, ['-s', device.target, 'shell', 'getprop', 'sys.boot_completed'], 10_000) !== '1') throw new Error('Android 尚未完成启动')
  } else {
    const found = parseIos(await sim(['list', 'devices', '--json'])).find((item) => item.udid === device.target && item.name === device.name)
    if (!found || found.state !== 'Booted') throw new Error('iOS 设备尚未启动或不存在')
    await sim(['getenv', device.target, 'SIMULATOR_UDID'], 10_000)
  }
}

function androidTemp(device: Device) {
  return path.join('/tmp', `binos-emu-${createHash('sha256').update(avdDir + device.id).digest('hex').slice(0, 16)}`)
}
async function androidProcess(device: Device): Promise<ProcessIdentity | undefined> {
  try {
    const record = JSON.parse(await readFile(path.join(emulatorHome, `${device.id}.json`), 'utf8')) as ProcessIdentity & { name: string }
    if (record.name !== device.name) throw new Error('Android 进程登记归属不匹配')
    return record
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
}
async function stopAndroid(device: Device) {
  const identity = await androidProcess(device)
  for (let attempt = 0; attempt < 60; attempt++) {
    const listed = await tool(adb, ['devices'])
    const connected = listed.split('\n').find((line) => line.startsWith(`${device.target}\t`))
    if (connected && !connected.endsWith('offline')) {
      await ownedAndroid(device)
      if (attempt === 0) await tool(adb, ['-s', device.target, 'emu', 'kill'])
    }
    const alive = identity && isRunning(identity)
    if (alive && (attempt >= 10 || connected?.endsWith('offline'))) {
      try { process.kill(-identity.pid, 'SIGKILL') } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error }
    }
    if (!connected && !alive) {
      const processes = await tool('ps', ['-axo', 'command='])
      const unrecorded = processes.split('\n').some((line) => /(?:qemu-system-|\/emulator\s)/.test(line) && line.split(/\s+/).some((arg) => arg === device.name || arg === `@${device.name}`))
      if (!unrecorded) {
        await rm(path.join(emulatorHome, `${device.id}.json`), { force: true })
        return
      }
    }
    await sleep(1000)
  }
  throw new Error('Android 进程尚未退出，保留设备与容量')
}
async function bootAndroid(device: Device, wipe: boolean) {
  const port = device.target.replace('emulator-', '')
  const config = await readFile(path.join(avdDir, `${device.name}.avd`, 'config.ini'), 'utf8')
  const target = /^target\s*=\s*(.+)$/m.exec(config)?.[1].trim()
  if (!target) throw new Error('受管理 AVD 缺少系统版本')
  await writeFile(path.join(avdDir, `${device.name}.ini`), `avd.ini.encoding=UTF-8\npath=${path.join(avdDir, `${device.name}.avd`)}\ntarget=${target}\n`)
  // 端口被外部设备占用时不能启动或清理，避免误操作另一个设备池。
  let available = false
  for (let attempt = 0; attempt < 30; attempt++) {
    available = await new Promise<boolean>((resolve) => {
      const server = net.createServer()
      server.once('error', () => resolve(false))
      server.listen(Number(port), '127.0.0.1', () => server.close(() => resolve(true)))
    })
    if (available) break
    await sleep(1000)
  }
  if (!available) throw new Error(`端口 ${port} 正在使用，请先确认设备归属`)
  await mkdir(emulatorHome, { recursive: true })
  const temp = androidTemp(device)
  await mkdir(temp, { recursive: true, mode: 0o700 })
  const log = openSync(path.join(emulatorHome, `${device.id}.log`), 'a', 0o600)
  const env: NodeJS.ProcessEnv = { ...toolEnv, ANDROID_EMULATOR_HOME: emulatorHome, TMPDIR: temp, ANDROID_TMP: temp, NETSIM_HCI_PORT: String(Number(port) + 6402) }
  for (const key of ['NETSIM_INSTANCE', 'NETSIM_GRPC_PORT', 'NETSIM_TCP_PORT', 'NETSIM_WS_PORT']) delete env[key]
  const child = spawn(emulator, ['-avd', device.name, '-port', port, '-no-window', '-no-audio', '-no-snapshot', '-no-metrics', '-netsim-args', `--hci-port ${Number(port) + 6402}`, ...(wipe ? ['-wipe-data'] : [])], {
    env, stdio: ['ignore', log, log], detached: true,
  })
  closeSync(log)
  let failed: Error | undefined
  child.on('error', (error) => { failed = error })
  if (child.pid) {
    const startedAt = processStartTime(child.pid)
    if (!startedAt) {
      try { process.kill(-child.pid, 'SIGKILL') } catch { /* 已退出。 */ }
      throw new Error('无法登记 Android 进程')
    }
    try { await writeFile(path.join(emulatorHome, `${device.id}.json`), JSON.stringify({ pid: child.pid, startedAt, name: device.name }), { mode: 0o600 }) }
    catch (error) { try { process.kill(-child.pid, 'SIGKILL') } catch { /* 已退出。 */ } throw error }
  }
  child.unref()
  for (let attempt = 0; attempt < 150; attempt++) {
    if (failed) throw failed
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Android 模拟器退出：${child.signalCode ?? child.exitCode}`)
    try { await health(device); return } catch { /* 启动阶段等待设备就绪。 */ }
    await sleep(2000)
  }
  throw new Error('Android 启动超过 5 分钟，设备已隔离')
}
export async function reset(device: Device) {
  if (mode === 'mock') { await sleep(100); return }
  if (device.platform === 'ios') {
    const found = parseIos(await sim(['list', 'devices', '--json'])).find((item) => item.udid === device.target && item.name === device.name)
    if (!found) throw new Error('受管理的 iOS 设备不存在')
    for (let attempt = 0; attempt < 30; attempt++) {
      const current = parseIos(await sim(['list', 'devices', '--json'])).find((item) => item.udid === device.target)
      if (current?.state === 'Shutdown') break
      try { await sim(['shutdown', device.target], 60_000) }
      catch (error) { if (attempt === 29) throw error }
      await sleep(1000)
    }
    await sim(['erase', device.target], 120_000)
    try { await sim(['boot', device.target], 60_000) }
    catch (error) {
      const current = parseIos(await sim(['list', 'devices', '--json'])).find((item) => item.udid === device.target)
      if (current?.state !== 'Booted' && current?.state !== 'Booting') throw error
    }
    await sim(['bootstatus', device.target, '-b'], 300_000)
  } else {
    await stopAndroid(device)
    await bootAndroid(device, true)
  }
  await health(device)
}

export async function create(device: Device): Promise<Device> {
  if (mode === 'mock') { await sleep(50); return { ...device, target: device.target || device.id, system: device.platform === 'ios' ? 'iOS-preview' : 'android-preview', ...(device.model && { modelName: mockModels.find((model) => model.id === device.model)?.name }) } }
  if (device.platform === 'ios') {
    await mkdir(iosSet, { recursive: true })
    const found = parseIos(await sim(['list', 'devices', '--json'])).find((item) => item.name === device.name)
    if (found) device = { ...device, target: found.udid, system: found.runtime, model: found.deviceTypeIdentifier ?? device.model }
    else {
      const installed = JSON.parse(await sim(['list', 'runtimes', '--json'])) as { runtimes: IosRuntime[] }
      const profile = iosProfile(installed.runtimes, device.model ?? process.env.BINOS_IOS_DEVICE_TYPE, process.env.BINOS_IOS_RUNTIME)
      const target = await sim(['create', device.name, profile.deviceType, profile.runtime], 120_000)
      device = { ...device, target, system: profile.runtime, model: profile.deviceType, modelName: profile.name }
    }
  } else {
    const image = process.env.BINOS_ANDROID_IMAGE ?? 'system-images;android-36;google_apis_playstore;arm64-v8a'
    if (!/^system-images;android-[\w.-]+;[\w-]+;[\w-]+$/.test(image)) throw new Error('Android 系统镜像标识无效')
    const parts = image.split(';')
    const imageDir = path.join(sdkDir, ...parts)
    if (!existsSync(path.join(imageDir, 'source.properties'))) throw new Error(`Android 系统镜像未安装：${image}`)
    const directory = path.join(avdDir, `${device.name}.avd`)
    await mkdir(directory, { recursive: true })
    await writeFile(path.join(directory, 'config.ini'), [
      `AvdId=${device.name}`, `avd.ini.displayname=${device.name}`, `image.sysdir.1=${imageDir}/`,
      `target=${parts[1]}`, `tag.id=${parts[2]}`, `abi.type=${parts[3]}`, `hw.cpu.arch=${parts[3] === 'arm64-v8a' ? 'arm64' : parts[3]}`, 'hw.cpu.ncore=2', 'hw.ramSize=2048',
      'hw.lcd.width=1080', 'hw.lcd.height=1920', 'hw.lcd.density=420', 'hw.gpu.enabled=yes', 'hw.gpu.mode=auto',
      'hw.keyboard=yes', 'hw.mainKeys=no', 'disk.dataPartition.size=4G',
    ].join('\n') + '\n')
    device = { ...device, system: parts[1] }
  }
  await reset(device)
  return device
}
export async function destroy(device: Device) {
  if (mode === 'mock') { await sleep(50); return }
  if (device.name !== `binos-${device.id}` || !/^(android|ios)-[a-z0-9-]+$/.test(device.id)) throw new Error('设备归属无效，拒绝销毁')
  if (device.platform === 'ios') {
    const devices = parseIos(await sim(['list', 'devices', '--json']))
    const found = devices.find((item) => item.name === device.name && (!device.target || item.udid === device.target))
    if (!found) {
      if (device.target && devices.some((item) => item.udid === device.target)) throw new Error('iOS 设备名称与归属不匹配，保留容量')
      return
    }
    if (found.state !== 'Shutdown') {
      try { await sim(['shutdown', found.udid], 60_000) }
      catch (error) {
        if (parseIos(await sim(['list', 'devices', '--json'])).some((item) => item.udid === found.udid && item.state !== 'Shutdown')) throw error
      }
    }
    await sim(['delete', found.udid], 120_000)
  } else {
    await stopAndroid(device)
    const directory = path.join(avdDir, `${device.name}.avd`)
    await rm(directory, { recursive: true, force: true })
    await rm(path.join(avdDir, `${device.name}.ini`), { force: true })
    await rm(androidTemp(device), { recursive: true, force: true })
  }
}
export async function screenshot(device: Device) {
  if (mode === 'mock') {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="390" height="780"><rect width="390" height="780" rx="32" fill="#f3f2ef"/><text x="195" y="350" text-anchor="middle" font-family="sans-serif" font-size="28">binOS Devices</text><text x="195" y="395" text-anchor="middle" font-family="sans-serif" font-size="18" fill="#777">模拟设备 · 预览</text></svg>'
    return { image: Buffer.from(svg).toString('base64'), mime: 'image/svg+xml', at: Date.now() }
  }
  await health(device)
  let png: Buffer
  if (device.platform === 'android') {
    const { stdout } = await exec(adb, ['-s', device.target, 'exec-out', 'screencap', '-p'], { env: toolEnv, encoding: 'buffer', timeout: 30_000, maxBuffer: 24 * 1024 * 1024 })
    png = stdout
  } else {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'binos-device-capture-'))
    try {
      const file = path.join(directory, 'screen.png')
      await sim(['io', device.target, 'screenshot', '--type=png', file])
      if ((await stat(file)).size > 24 * 1024 * 1024) throw new Error('截图超过 24 MiB')
      png = await readFile(file)
    } finally { await rm(directory, { recursive: true, force: true }) }
  }
  if (png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('截图未生成有效 PNG，请稍后重试')
  return { image: png.toString('base64'), mime: 'image/png', at: Date.now() }
}
export function deviceEnv(devices: Device[]) {
  const android = devices.find((device) => device.platform === 'android')
  const ios = devices.find((device) => device.platform === 'ios')
  return { ANDROID_HOME: sdkDir, ANDROID_AVD_HOME: avdDir, BINOS_IOS_DEVICE_SET: iosSet,
    ...(javaHome && { JAVA_HOME: javaHome }),
    PATH: [javaHome && path.join(javaHome, 'bin'), path.join(sdkDir, 'platform-tools'), path.join(sdkDir, 'emulator'), process.env.PATH].filter(Boolean).join(path.delimiter),
    ...(android && { ANDROID_SERIAL: android.target, BINOS_ANDROID_AVD: android.name }), ...(ios && { BINOS_IOS_UDID: ios.target }) }
}
