import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { rootLayout } from './layout.ts'
import { previewDirName } from './preview-info.ts'
import { acquireProcessLock, isAlive, isRunning } from './process.ts'
import type { ProcessIdentity } from './process.ts'

// 预览实例的停止和清理。上线脚本和构建服务都会用到，所以只依赖同样被脚本直接运行的文件

// 预览目录同时是预览实例的根目录：构建按提交放在里面，数据在它的 Library/ 里
export function previewPaths(previewsDir: string, pr: number) {
  const dir = path.join(previewsDir, previewDirName(pr))
  return {
    dir,
    lock: path.join(dir, '.preview.lock'),
    serverLock: rootLayout(dir).serverLockPath,
    serverLog: path.join(dir, 'server.log'),
  }
}

export function runningPreviewServer(serverLock: string): ProcessIdentity | undefined {
  const server = readJson<ProcessIdentity>(serverLock)
  return server && isRunning(server) ? server : undefined
}

export async function stopPreviewServer(serverLock: string) {
  const server = runningPreviewServer(serverLock)
  if (!server) {
    return
  }
  process.kill(server.pid, 'SIGTERM')
  for (let i = 0; i < 100 && isAlive(server.pid); i++) {
    await sleep(100)
  }
  if (isAlive(server.pid)) {
    throw new Error(`预览实例（进程 ${server.pid}）10 秒内没有退出`)
  }
}

// 设备和构建管理进程独立于网页后端；删除构建或数据前也要结束它，避免残留进程继续读写旧目录。
export async function stopPreviewDevices(dir: string) {
  await stopPreviewBuilds(dir)
  const lock = path.join(rootLayout(dir).devicesServiceDir, 'manager.lock')
  const manager = readJson<ProcessIdentity>(lock)
  if (!manager || !isRunning(manager)) return
  process.kill(manager.pid, 'SIGTERM')
  for (let i = 0; i < 100 && isRunning(manager); i++) await sleep(100)
  if (isRunning(manager)) throw new Error(`设备预览进程 ${manager.pid} 未能退出`)
}

// PR 合并或关闭后，停止并删除它的预览。open 是开着的 PR，查不到时不要调用，免得网络出错时误删
export async function closeFinishedPreviews(previewsDir: string, open: Set<number>, say: (message: string) => void) {
  let entries: string[]
  try {
    entries = readdirSync(previewsDir)
  } catch {
    return
  }
  for (const entry of entries) {
    const pr = Number(/^pr-(\d+)$/.exec(entry)?.[1])
    if (!pr || open.has(pr)) {
      continue
    }
    const paths = previewPaths(previewsDir, pr)
    // 正在由 pnpm preview 更新的预览留到下一次
    if (acquireProcessLock(paths.lock)) {
      continue
    }
    await stopPreviewServer(paths.serverLock)
    await stopPreviewDevices(paths.dir)
    rmSync(paths.dir, { recursive: true, force: true })
    say(`PR #${pr} 已合并或关闭，删除了它的预览`)
  }
}

export function readJson<T>(file: string): T | undefined {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T
  } catch {
    return undefined
  }
}

async function stopPreviewBuilds(dir: string) {
  const data = path.join(rootLayout(dir).appsDir, 'builds')
  const manager = readJson<ProcessIdentity>(path.join(data, 'manager.lock'))
  if (manager && isRunning(manager)) {
    process.kill(manager.pid, 'SIGTERM')
    for (let i = 0; i < 100 && isRunning(manager); i++) await sleep(100)
    if (isRunning(manager)) throw new Error('构建预览服务未退出')
  }
  const results = path.join(data, 'results')
  if (!existsSync(results)) return
  for (const id of readdirSync(results)) {
    const runner = readJson<ProcessIdentity>(path.join(results, id, 'runner.json'))
    if (runner && isRunning(runner)) {
      process.kill(runner.pid, 'SIGTERM')
      for (let i = 0; i < 100 && isRunning(runner); i++) await sleep(100)
      if (isRunning(runner)) throw new Error('预览构建未退出')
    }
    const child = readJson<ProcessIdentity>(path.join(results, id, 'child.json'))
    if (child && isRunning(child)) { try { process.kill(-child.pid, 'SIGKILL') } catch { /* 进程已结束。 */ } }
  }
}
