import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, expect, it, vi } from 'vitest'
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
const { Manager } = await import('./manager.js')
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
})
