import { preparePty } from './prepare-pty.ts'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const run = (command: string, args: string[], cwd: string) => execFileSync(command, args, { cwd, stdio: 'inherit' })

// 在 workDir 里构建完整的仓库，返回两端的构建结果，都在 workDir 里。server 是只放运行需要的部分的 server 包：
// 命令行 bin/binos、构建结果、schema、扩展和按锁文件只装的生产依赖；web 是页面的构建产物，version.json 是页面用来发现新版本的。
// workDir 由调用方清理
export function buildUnits(repoDir: string, commit: string, workDir: string) {
  const source = path.join(workDir, 'source')
  const server = path.join(workDir, 'build')
  const web = path.join(workDir, 'web')
  mkdirSync(source, { recursive: true })
  // 只取这个提交里的代码，不混入工作区里未提交的改动
  const archive = path.join(workDir, 'source.tar')
  execFileSync('git', ['archive', '--output', archive, commit], { cwd: repoDir })
  run('tar', ['-xf', archive, '-C', source], source)
  // 两端各自安装、各自构建；后端的构建顺带构建它引用的契约
  for (const side of ['server', 'web']) {
    run('pnpm', ['install', '--frozen-lockfile'], path.join(source, side))
    run('pnpm', ['build'], path.join(source, side))
  }
  mkdirSync(server)
  for (const file of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'protocol.schema.json', 'dist', 'bin', 'extensions']) {
    cpSync(path.join(source, 'server', file), path.join(server, file), { recursive: true })
  }
  // 安装脚本只准备开发用的 node-pty，构建里直接做
  run('pnpm', ['install', '--prod', '--frozen-lockfile', '--ignore-scripts'], server)
  preparePty(path.join(server, 'package.json'))
  writeFileSync(path.join(server, 'VERSION'), commit + '\n')
  cpSync(path.join(source, 'web', 'dist'), web, { recursive: true })
  writeFileSync(path.join(web, 'VERSION'), commit + '\n')
  writeFileSync(path.join(web, 'version.json'), JSON.stringify({ version: commit }) + '\n')
  return { server, web }
}

// 预览的页面和后端一起：页面放在后端的 web/dist 里，由预览的后端直接提供
export function buildCommit(repoDir: string, commit: string, workDir: string) {
  const { server, web } = buildUnits(repoDir, commit, workDir)
  mkdirSync(path.join(server, 'web'))
  renameSync(web, path.join(server, 'web', 'dist'))
  return server
}

async function poll(check: () => Promise<boolean>) {
  for (let i = 0; i < 60; i++) {
    await sleep(500)
    try {
      if (await check()) return true
    } catch {
      // 还没启动好
    }
  }
  return false
}

// 后端在运行这个提交
export function isServerHealthy(port: number, commit: string) {
  return poll(async () => ((await (await fetch(`http://127.0.0.1:${port}/api/health`)).json()) as { version?: string }).version === commit)
}

// 后端提供的页面是这个提交的
export function isWebHealthy(port: number, commit: string) {
  const base = `http://127.0.0.1:${port}`
  return poll(async () => {
    const { version } = (await (await fetch(`${base}/version.json`)).json()) as { version?: string }
    const page = await fetch(`${base}/`)
    return version === commit && page.ok && (await page.text()).includes('id="root"')
  })
}

export async function isHealthy(port: number, commit: string) {
  return (await isServerHealthy(port, commit)) && (await isWebHealthy(port, commit))
}
