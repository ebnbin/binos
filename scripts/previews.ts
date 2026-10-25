import { execFileSync, spawn } from 'node:child_process'
import { closeSync, existsSync, openSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { previewDirName, previewInfoPath } from '../server/src/preview-info.ts'
import type { PreviewInfo } from '../server/src/preview-info.ts'
import { previewPaths, readJson, runningPreviewServer, stopPreviewDevices, stopPreviewServer } from '../server/src/preview-instances.ts'
import { acquireProcessLock } from '../server/src/process.ts'
import { buildCommit, isHealthy } from './build.ts'
import { freePort } from './net.ts'

// 预览实例是测试实例：数据在预览目录里，借用正式版 agent 的登录，agent 在 PR 的 worktree 里工作。
// 自成一个进程组，启动它的 agent 和 session 结束后仍在运行
export function startPreviewServer(options: {
  dir: string
  buildDir: string
  serverLog: string
  port: number
  repoDir: string
  agentsDir: string
}) {
  const log = openSync(options.serverLog, 'a')
  try {
    const child = spawn(process.execPath, [path.join(options.buildDir, 'server', 'dist', 'index.js')], {
      cwd: options.dir,
      detached: true,
      stdio: ['ignore', log, log],
      env: {
        ...process.env,
        // 去掉包管理器运行脚本时临时加入的目录
        PATH: process.env.PATH!.split(':').filter((dir) => !dir.includes('node_modules')).join(':'),
        BINOS_ROOT: options.dir,
        BINOS_TEST_INSTANCE: '1',
        BINOS_AGENTS_DIR: options.agentsDir,
        BINOS_REPO_DIR: options.repoDir,
        PORT: String(options.port),
      },
    })
    child.unref()
  } finally {
    closeSync(log)
  }
}

// 开着的 PR；查不到时返回 undefined
export function openPullRequests(repoDir: string): Set<number> | undefined {
  try {
    const numbers = execFileSync('gh', ['pr', 'list', '--state', 'open', '--limit', '1000', '--json', 'number', '--jq', '.[].number'], {
      cwd: repoDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return new Set(numbers.split('\n').filter(Boolean).map(Number))
  } catch {
    return undefined
  }
}

// 把一个提交构建成 PR 的预览并启动；预览已经在这个提交上时什么都不做。
// sourceRepo 用来取提交的代码，agentRepo 是预览里 agent 工作的 worktree
export async function deployPreview(options: { previewsDir: string; agentsDir: string; sourceRepo: string; agentRepo: string; number: number; commit: string; say: (message: string) => void }) {
  const { previewsDir, number, commit, say } = options
  const short = commit.slice(0, 7)
  const paths = previewPaths(previewsDir, number)
  const infoPath = previewInfoPath(previewsDir, previewDirName(number))
  const holder = acquireProcessLock(paths.lock)
  if (holder) {
    throw new Error(`PR #${number} 的预览正在由进程 ${holder.pid} 更新`)
  }
  if (readJson<PreviewInfo>(infoPath)?.commit === commit && runningPreviewServer(paths.serverLock)) {
    say(`PR #${number} 的预览已经是 ${short}`)
    return
  }
  const buildDir = path.join(paths.dir, commit)
  if (!existsSync(buildDir)) {
    say(`构建 ${short}`)
    const workDir = `${buildDir}.tmp`
    rmSync(workDir, { recursive: true, force: true })
    try {
      renameSync(buildCommit(options.sourceRepo, commit, workDir), buildDir)
    } finally {
      rmSync(workDir, { recursive: true, force: true })
    }
  }
  await stopPreviewServer(paths.serverLock)
  await stopPreviewDevices(paths.dir)
  const port = await freePort()
  writeFileSync(infoPath, JSON.stringify({ port, commit } satisfies PreviewInfo) + '\n')
  startPreviewServer({ dir: paths.dir, buildDir, serverLog: paths.serverLog, port, repoDir: options.agentRepo, agentsDir: options.agentsDir })
  if (!(await isHealthy(port, commit))) {
    throw new Error(`${short} 的预览没有正常启动，日志见 ${paths.serverLog}`)
  }
  for (const entry of readdirSync(paths.dir)) {
    if (/^[0-9a-f]{40}$/.test(entry) && entry !== commit) {
      rmSync(path.join(paths.dir, entry), { recursive: true, force: true })
    }
  }
}
