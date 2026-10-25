import { execFile, spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterAll, expect, it } from 'vitest'
const exec = promisify(execFile)
const root = mkdtempSync(path.join(os.tmpdir(), 'binos-runner-test-'))
const source = path.join(root, 'source'); const output = path.join(root, 'outputs'); const result = path.join(root, 'result.json')
mkdirSync(path.join(source, 'scripts'), { recursive: true }); mkdirSync(output)
const entry = path.join(import.meta.dirname, 'runner.ts')
const loader = path.resolve(import.meta.dirname, '../../../node_modules/tsx/dist/loader.mjs')
const args = ['--import', loader, entry, source, output, result, 'android', '1', 'real']
afterAll(() => rmSync(root, { recursive: true, force: true }))
it('脚本退出为零但缺少预期产物时拒绝成功', async () => {
  writeFileSync(path.join(source, 'scripts/mobile-build.sh'), 'echo hello\n')
  await exec(process.execPath, args)
  expect(JSON.parse(readFileSync(result, 'utf8'))).toMatchObject({ status: 'failed', artifacts: [], error: '构建没有生成 binos-android-debug.apk' })
  expect(readFileSync(path.join(root, 'build.log'), 'utf8')).toContain('hello')
})
it('取消会结束构建子进程组并保存终态', async () => {
  const marker = path.join(root, 'marker')
  writeFileSync(path.join(source, 'scripts/mobile-build.sh'), `touch '${marker}'\nsleep 60\n`)
  const child = spawn(process.execPath, args, { stdio: 'ignore' })
  const done = new Promise<void>((resolve) => child.on('exit', () => resolve()))
  for (let i = 0; i < 100 && !existsSync(marker); i++) await new Promise((r) => setTimeout(r, 30))
  expect(existsSync(marker)).toBe(true)
  child.kill('SIGTERM'); await done
  expect(JSON.parse(readFileSync(result, 'utf8'))).toMatchObject({ status: 'cancelled', error: '已取消' })
  const processId = JSON.parse(readFileSync(path.join(root, 'child.json'), 'utf8')).pid
  expect(() => process.kill(processId, 0)).toThrow('ESRCH')
}, 10_000)
