import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { afterAll, describe, expect, it, vi } from 'vitest'

const { execute, launch, controls } = vi.hoisted(() => ({
  execute: vi.fn<(command: string, args: string[]) => Promise<{ stdout: string | Buffer }>>(),
  launch: vi.fn<(...args: unknown[]) => unknown>(),
  controls: { empty: false, other: false, capture: '', iosState: 'Booted', iosName: 'iPhone', androidConnected: false },
}))
vi.mock('node:child_process', async (original) => ({
  ...await original<typeof import('node:child_process')>(),
  spawn: launch,
  execFile: Object.assign(() => {}, { [Symbol.for('nodejs.util.promisify.custom')]: execute }),
}))
const root = mkdtempSync(path.join(os.tmpdir(), 'binos-platform-'))
process.env.BINOS_ROOT = root
process.env.BINOS_DEVICES_MODE = 'real'
const { screenshot, reset, create, destroy } = await import('./platform.js')
const png = Buffer.from('89504e470d0a1a0a', 'hex')
// simctl io enumerate 的屏幕部分：内屏排在主屏前面，另有不是内置屏幕的 CarPlay
const screens = ['(3) LCD-1:', 'Screen ID: 3', 'Name: LCD-1', 'Device Name: primary-1', 'Screen Type: Integrated', 'Pixel Size: {2007, 2853}',
  '(4) Wireless:', 'Name: Wireless', 'Device Name: wireless0', 'Screen Type: CarPlay', 'Pixel Size: {720, 480}',
  '(1) LCD:', 'Name: LCD', 'Device Name: primary', 'Screen Type: Integrated', 'Pixel Size: {1398, 2034}'].map((line) => `    ${line}`).join('\n')
execute.mockImplementation(async (command, args) => {
  if (command === 'ps') return { stdout: '' }
  if (command.endsWith('/adb') && args[0] === 'devices') return { stdout: controls.androidConnected ? 'List of devices attached\nemulator-5560\tdevice\n' : 'List of devices attached\n' }
  if (args.includes('delete')) return { stdout: '' }
  if (args.includes('list')) return { stdout: JSON.stringify({ devices: { runtime: [{ udid: 'ios-id', name: controls.iosName, state: controls.iosState }] } }) }
  if (args.includes('shutdown')) { controls.iosState = 'Shutdown'; throw new Error('设备已经 Shutdown') }
  if (args.includes('erase') || args.includes('bootstatus')) return { stdout: '' }
  if (args.includes('boot')) { controls.iosState = 'Booted'; return { stdout: '' } }
  if (args.includes('getenv')) return { stdout: 'ios-id' }
  if (args.includes('enumerate')) return { stdout: `Connected Screens:\n${screens}` }
  if (args.includes('screenshot')) { controls.capture = args.at(-1)!; writeFileSync(controls.capture, controls.empty ? Buffer.alloc(0) : png); return { stdout: '' } }
  if (args.includes('name')) return { stdout: `${controls.other ? 'AnotherDevice' : 'Android'}\r\nOK\r\n` }
  if (args.includes('getprop')) return { stdout: '1' }
  if (args.includes('screencap')) return { stdout: controls.empty ? Buffer.alloc(0) : png }
  throw new Error('未预期的设备命令')
})
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('平台操作', () => {
  it('中断创建后按专属名称找回 iOS，重试不重复创建，销毁限定设备所在的设备集；登记内置屏幕，主屏在前', async () => {
    const device = { id: 'ios-12345678', platform: 'ios' as const, name: 'binos-ios-12345678', target: '', status: 'creating' as const }
    controls.iosName = device.name
    const before = execute.mock.calls.length
    const recovered = await create(device)
    expect(recovered.target).toBe('ios-id')
    expect(recovered.displays).toEqual([{ id: 'primary', name: 'LCD', width: 1398, height: 2034 }, { id: 'primary-1', name: 'LCD-1', width: 2007, height: 2853 }])
    expect(execute.mock.calls.slice(before).some(([, args]) => args.includes('create'))).toBe(false)
    await destroy(recovered)
    expect(execute.mock.calls.slice(before).filter(([command]) => command === 'xcrun').every(([, args]) => args[0] === 'simctl' && args[1] === '--set' && args[2] === recovered.iosSet)).toBe(true)
    controls.iosName = 'iPhone'
  })
  it('销毁拒绝错误归属；端口被其他模拟器使用时不删除目录', async () => {
    const device = { id: 'android-12345678', platform: 'android' as const, name: 'binos-android-12345678', target: 'emulator-5560', status: 'destroying' as const }
    const { avdDir } = await import('./config.js')
    const directory = path.join(avdDir, `${device.name}.avd`)
    mkdirSync(directory, { recursive: true })
    await expect(destroy({ ...device, name: 'external' })).rejects.toThrow('归属无效')
    controls.androidConnected = true
    controls.other = true
    await expect(destroy(device)).rejects.toThrow('其他模拟器')
    expect(existsSync(directory)).toBe(true)
    controls.androidConnected = false
    controls.other = false
    await destroy(device)
    expect(existsSync(directory)).toBe(false)
  })
  it('Android 网络发现保持默认实例，临时目录独立，避免客户端连接不存在的发现文件', async () => {
    const { avdDir } = await import('./config.js')
    const directory = path.join(avdDir, 'Android.avd')
    mkdirSync(directory, { recursive: true })
    writeFileSync(path.join(directory, 'config.ini'), 'target=android-36\n')
    launch.mockImplementation(() => Object.assign(new EventEmitter(), { pid: process.pid, exitCode: null, signalCode: null, unref() {} }))
    const previous = process.env.NETSIM_INSTANCE
    process.env.NETSIM_INSTANCE = '123'
    try {
      await reset({ id: 'android-network-test', platform: 'android', name: 'Android', target: 'emulator-0', status: 'cleaning' })
      const [, args, options] = launch.mock.calls.at(-1)!
      const flags = args as string[]
      const env = (options as { env: NodeJS.ProcessEnv }).env
      expect(flags[flags.indexOf('-netsim-args') + 1]).not.toContain('--instance')
      expect(env.NETSIM_INSTANCE).toBeUndefined()
      expect(env.TMPDIR).toContain('binos-emu-')
      expect(env.NETSIM_HCI_PORT).toBe('6402')
    } finally {
      if (previous === undefined) delete process.env.NETSIM_INSTANCE
      else process.env.NETSIM_INSTANCE = previous
    }
  })
  it('iOS 查询后已经关闭的竞态不会阻止恢复清理', async () => {
    await expect(reset({ id: 'ios', platform: 'ios', name: 'iPhone', target: 'ios-id', status: 'cleaning' })).resolves.toBeUndefined()
    expect(controls.iosState).toBe('Booted')
  })
  it('iOS 从临时文件读取 PNG，始终清理临时内容，拒绝空截图', async () => {
    const device = { id: 'ios', platform: 'ios' as const, name: 'iPhone', target: 'ios-id', status: 'free' as const }
    expect((await screenshot(device)).image).toBe(png.toString('base64'))
    expect(existsSync(controls.capture)).toBe(false)
    controls.empty = true
    await expect(screenshot(device)).rejects.toThrow('截图未生成有效 PNG')
    expect(existsSync(controls.capture)).toBe(false)
    controls.empty = false
  })
  it('ADB 名称的 CRLF 不影响归属核对，空输出不会作为成功截图返回', async () => {
    const device = { id: 'android', platform: 'android' as const, name: 'Android', target: 'emulator-5560', status: 'free' as const }
    expect((await screenshot(device)).image).toBe(png.toString('base64'))
    controls.empty = true
    await expect(screenshot(device)).rejects.toThrow('截图未生成有效 PNG')
    controls.empty = false
    controls.other = true
    await expect(screenshot(device)).rejects.toThrow('设备端口由其他模拟器使用')
    controls.other = false
  })
})
