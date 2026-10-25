import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, expect, it, vi } from 'vitest'
import type { Build } from './types.js'
const fixture = vi.hoisted(() => ({ root: '', repo: '' }))
vi.mock('./config.js', () => ({ automatic: false, mock: false, repository: fixture.repo, resultsDir: path.join(fixture.root, 'results'), workDir: path.join(fixture.root, 'work'), statePath: path.join(fixture.root, 'state.json'), version: 'test' }))
const root = mkdtempSync(path.join(os.tmpdir(), 'binos-build-scheduler-'))
fixture.root = root; fixture.repo = path.join(root, 'repo')
mkdirSync(fixture.repo)
const git = (...args: string[]) => execFileSync('git', args, { cwd: fixture.repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
git('init', '-b', 'main'); git('config', 'user.email', 'test@example.invalid'); git('config', 'user.name', 'Test')
mkdirSync(path.join(fixture.repo, 'scripts'))
writeFileSync(path.join(fixture.repo, 'scripts/mobile-build.sh'), '#!/bin/bash\n')
git('add', '.'); git('commit', '-m', 'initial'); git('remote', 'add', 'origin', fixture.repo)
const { Manager, expired } = await import('./manager.js')
afterAll(() => rmSync(root, { recursive: true, force: true }))
it('自动检查按提交和目标去重，新 main 替换未开始的旧任务，取消后不再自动排上', async () => {
  const manager = new Manager()
  // 本地源没有 GitHub PR；main 的自动构建仍应入队，并报告 PR 查询错误。
  await manager.poll(); await manager.poll()
  let builds = manager.snapshot().builds
  expect(builds).toHaveLength(2)
  expect(builds.every((b) => b.trigger === 'main' && b.status === 'queued')).toBe(true)
  writeFileSync(path.join(fixture.repo, 'changed'), 'new')
  git('add', '.'); git('commit', '-m', 'update')
  await manager.poll()
  builds = manager.snapshot().builds
  expect(builds).toHaveLength(2)
  expect(builds.every((b) => b.status === 'queued' && b.commit === git('rev-parse', 'HEAD'))).toBe(true)
  expect(manager.snapshot().pollError).toBeTruthy()
  await manager.request({ action: 'cancel', id: builds[0].id })
  await manager.poll()
  expect(manager.snapshot().builds.map((b) => b.status).sort()).toEqual(['cancelled', 'queued'])
  // web 只构建 PR；main 只编提交里有构建脚本的目标
  expect(new Set(manager.snapshot().builds.map((b) => b.target))).toEqual(new Set(['android', 'ios']))
  await expect(manager.request({ action: 'enqueue', ref: 'main', targets: ['web'] })).rejects.toThrow('web 只构建 PR')
})
it('保留 main 最近 5 个提交和打开 PR 的最新提交，其余结束满 3 天才删除', () => {
  const at = Date.parse('2026-01-31T00:00:00Z')
  const ended = (days: number) => new Date(at - days * 86_400_000).toISOString()
  const build = (id: string, trigger: Build['trigger'], commit: string, days: number, pr?: number): Build => ({ id, commit, target: 'android', trigger, ...(pr && { pr }), status: 'success', createdAt: ended(days + 1), endedAt: ended(days), artifacts: [] })
  const builds: Build[] = [
    ...Array.from({ length: 6 }, (_, i) => build(`main-${i}`, 'main', `m${i}`, 10 - i)),
    build('open-old', 'pr', 'a1', 9, 1), build('open-new', 'pr', 'a2', 8, 1),
    build('closed', 'pr', 'b1', 9, 2), build('closed-recent', 'pr', 'b2', 1, 2),
    build('manual', 'manual', 'c1', 4), { ...build('queued', 'manual', 'c2', 9), status: 'queued' as const },
  ]
  expect(expired(builds, new Set([1]), at).map((b) => b.id).sort()).toEqual(['closed', 'main-0', 'manual', 'open-old'])
  expect(expired(builds, new Set(), at).map((b) => b.id)).toContain('open-new')
  expect(expired(builds, undefined, at).map((b) => b.id)).not.toContain('open-new')
})
