import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterAll, expect, it } from 'vitest'
import type { Snapshot } from './types.js'
const exec = promisify(execFile)
const root = mkdtempSync(path.join(os.tmpdir(), 'binos-builds-test-'))
const repo = path.resolve(import.meta.dirname, '../../../..')
const env = { ...process.env, BINOS_ROOT: root, BINOS_TEST_INSTANCE: '1' }
const cli = async (...args: string[]) => JSON.parse((await exec(path.join(repo, 'bin/binos'), ['builds', ...args], { env, timeout: 15_000 })).stdout) as Snapshot
async function until(test: () => Promise<boolean>) { for (let i = 0; i < 120; i++) { if (await test()) return; await new Promise((r) => setTimeout(r, 100)) } throw new Error('构建验证超时') }
afterAll(async () => {
  for (let i = 0; i < 50; i++) { try { await cli('stop'); break } catch { await new Promise((r) => setTimeout(r, 100)) } }
  await new Promise((r) => setTimeout(r, 200)); rmSync(root, { recursive: true, force: true })
})
it('独立服务在重启后接续构建，保存产物，支持重试和取消排队', async () => {
  const first = await cli('enqueue', 'main', 'android,ios-simulator')
  expect(first.mode).toBe('mock'); expect(first.builds).toHaveLength(2)
  expect(first.settings.automatic).toBe(false)
  await until(async () => (await cli('status')).builds.some((b) => b.status === 'running'))
  const lock = JSON.parse(readFileSync(path.join(root, 'Library/Apps/builds/manager.lock'), 'utf8'))
  process.kill(lock.pid, 'SIGKILL')
  await until(async () => (await cli('status')).builds.every((b) => b.status === 'success'))
  const done = await cli('status')
  const android = done.builds.find((b) => b.target === 'android')!
  expect(android.artifacts).toMatchObject([{ name: 'binos-android-debug.apk', kind: 'install', platform: 'android' }])
  expect(android.artifacts[0].sha256).toHaveLength(64)
  expect(done.builds.find((b) => b.target === 'ios-simulator')!.artifacts).toEqual([])
  expect(readFileSync(path.join(root, 'Library/Apps/builds/results', android.id, 'outputs/binos-android-debug.apk'), 'utf8')).toContain('预览构建')
  const retry = await cli('retry', android.id)
  expect(retry.builds).toHaveLength(3)
  await cli('enqueue', 'a'.repeat(40), 'android,ios-simulator')
  const queued = (await cli('status')).builds.find((b) => b.status === 'queued')!
  await cli('cancel', queued.id)
  expect((await cli('status')).builds.find((b) => b.id === queued.id)?.status).toBe('cancelled')
  await until(async () => (await cli('status')).builds.every((b) => !['queued', 'running'].includes(b.status)))
}, 30_000)
