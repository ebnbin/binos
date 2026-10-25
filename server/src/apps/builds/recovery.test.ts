import { execFile, execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterAll, expect, it } from 'vitest'
import type { BuildsSnapshot } from './types.js'
const root = mkdtempSync(path.join(os.tmpdir(), 'binos-build-recovery-'))
const fixture = path.join(root, 'repo'); mkdirSync(path.join(fixture, 'scripts'), { recursive: true })
const git = (...args: string[]) => execFileSync('git', args, { cwd: fixture, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
git('init', '-b', 'main'); git('config', 'user.email', 'test@example.invalid'); git('config', 'user.name', 'Test')
writeFileSync(path.join(fixture, 'scripts/mobile-build.sh'), 'echo running\nsleep 60\n')
git('add', '.'); git('commit', '-m', 'fixture'); const commit = git('rev-parse', 'HEAD')
const exec = promisify(execFile)
const repo = path.resolve(import.meta.dirname, '../../../..')
const env = { ...process.env, BINOS_ROOT: root, BINOS_TEST_INSTANCE: '1', BINOS_BUILDS_MODE: 'real', BINOS_BUILDS_REPO: fixture }
const cli = async (...args: string[]) => JSON.parse((await exec(path.join(repo, 'bin/binos'), ['builds', ...args], { env, timeout: 15_000 })).stdout) as BuildsSnapshot
async function until(test: () => Promise<boolean>) { for (let i = 0; i < 180; i++) { if (await test()) return; await new Promise((r) => setTimeout(r, 100)) } throw new Error('恢复验证超时') }
afterAll(async () => {
  for (let i = 0; i < 30; i++) { try { await cli('stop'); break } catch { await new Promise((r) => setTimeout(r, 100)) } }
  await new Promise((r) => setTimeout(r, 200)); rmSync(root, { recursive: true, force: true })
})
it('runner 意外退出后结束遗留构建进程组并标记中断', async () => {
  const b = (await cli('enqueue', commit, 'android')).builds[0]
  const resultDir = path.join(root, 'Library/Apps/builds/results', b.id)
  await until(async () => existsSync(path.join(resultDir, 'child.json')))
  const child = JSON.parse(readFileSync(path.join(resultDir, 'child.json'), 'utf8'))
  const runner = JSON.parse(readFileSync(path.join(resultDir, 'runner.json'), 'utf8'))
  process.kill(runner.pid, 'SIGKILL')
  await until(async () => (await cli('status')).builds[0].status === 'interrupted')
  expect(() => process.kill(child.pid, 0)).toThrow('ESRCH')
  expect((await cli('status')).builds[0].artifacts).toEqual([])
}, 25_000)
