import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterAll, describe, expect, it } from 'vitest'
import type { LeaseResult, Snapshot } from './types.js'

const root = mkdtempSync(path.join(os.tmpdir(), 'binos-device-lifecycle-'))
const exec = promisify(execFile)
const repo = path.resolve(import.meta.dirname, '../../..')
const env = { ...process.env, BINOS_ROOT: root, BINOS_TEST_INSTANCE: '1', BINOS_DEVICES_MODE: 'mock' }
async function cli(...args: string[]) {
  const result = await exec(path.join(repo, 'bin/binos'), ['devices', ...args], { cwd: root, env, timeout: 15_000 })
  return result.stdout
}
const status = async () => JSON.parse(await cli('status')) as Snapshot
async function until(test: () => boolean | Promise<boolean>) {
  for (let i = 0; i < 100; i++) { if (await test()) return; await new Promise((resolve) => setTimeout(resolve, 50)) }
  throw new Error('设备服务验证超时')
}
afterAll(async () => {
  const snapshot = await status().catch(() => undefined)
  if (snapshot) process.kill(snapshot.pid, 'SIGTERM')
  rmSync(root, { recursive: true, force: true })
})

describe('独立进程设备服务', () => {
  it('CLI 共用服务；命令执行保活；服务重启保留租约并终止遗留命令；释放后清理', async () => {
    const first = await status()
    const acquired = JSON.parse(await cli('acquire', '--platform', 'both', '--session', 'thread-a', '--wait', '10')) as LeaseResult
    const lease = acquired.lease!
    const marker = path.join(root, 'started')
    const run = cli('run', '--lease', lease.id, '--session', 'thread-a', '--', process.execPath, '-e', `require('fs').writeFileSync(${JSON.stringify(marker)}, process.env.BINOS_THREAD_ID);setTimeout(()=>{},10000)`).then(() => 'success', () => 'disconnected')
    await until(() => existsSync(marker))
    expect(readFileSync(marker, 'utf8')).toBe('thread-a')
    await expect(cli('release', '--lease', lease.id, '--session', 'thread-a')).rejects.toThrow('受管理命令仍在执行')
    await expect(cli('maintenance', lease.devices[0])).rejects.toThrow('未知设备命令')
    process.kill(first.pid, 'SIGKILL')
    expect(await run).toBe('disconnected')
    const restarted = await status()
    expect(restarted.pid).not.toBe(first.pid)
    expect(restarted.leases[0].id).toBe(lease.id)
    const output = await cli('run', '--lease', lease.id, '--session', 'thread-a', '--', process.execPath, '-e', "console.log(process.env.BINOS_THREAD_ID, process.env.ANDROID_SERIAL, process.env.BINOS_IOS_UDID)", '--', '--session', 'ignored')
    expect(output).toContain('thread-a emulator-5560 ios-')
    await expect(cli('renew', '--lease', lease.id, '--session', 'thread-b')).rejects.toThrow('设备租约已失效')
    await cli('release', '--lease', lease.id, '--session', 'thread-a')
    await until(async () => (await status()).devices.every((device) => device.status === 'free'))
    expect((await status()).leases).toHaveLength(0)
  }, 30_000)
})
