import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { rootFromEnv, rootLayout } from '../server/src/layout.ts'
import { acquireProcessLock } from '../server/src/process.ts'
import { serverLabel, serverPort } from '../server/src/production.ts'
import { buildCommit, isHealthy } from './build.ts'
import { installBuild, swapPrevious, undoInstall, versionOf } from './install.ts'
import { closeFinishedPreviews } from '../server/src/preview-instances.ts'
import { openPullRequests } from './previews.ts'

const { binosDir, deployDir, logsDir, previewsDir, dataRevisionPath } = rootLayout(rootFromEnv())
const repoDir = path.resolve(import.meta.dirname, '..')
const serverLog = path.join(logsDir, 'server.log')
const tmpDir = path.join(deployDir, 'tmp')
// main 停在这个提交时不再自动上线：它上线失败过，或者被回退了
const failedPath = path.join(deployDir, 'failed')
const slots = { current: binosDir, previous: path.join(deployDir, 'previous') }

const git = (...args: string[]) => execFileSync('git', args, { cwd: repoDir, encoding: 'utf8' }).trim()
const short = (commit: string) => commit.slice(0, 7)
const say = (message: string) => console.log(`${new Date().toISOString()} ${message}`)

const command = process.argv[2]
if (command !== 'deploy' && command !== 'rollback') {
  throw new Error('用法：node scripts/deploy.ts deploy | rollback')
}

// 这次上线的临时目录：bin/binos deploy 把仓库克隆在它的 repo/ 里，手动运行时新建一个。
// 结束时删除，删不掉的（比如 Finder 正往里面写 .DS_Store）由下一次上线删除
mkdirSync(tmpDir, { recursive: true })
const workDir = path.dirname(path.dirname(repoDir)) === tmpDir ? path.dirname(repoDir) : mkdtempSync(tmpDir + path.sep)
const aside = path.join(workDir, 'old')
process.on('exit', () => remove(workDir))

const holder = acquireProcessLock(path.join(deployDir, 'lock'))
if (holder) {
  say(`已有上线或回退在进行（进程 ${holder.pid}），这次跳过`)
  process.exit(0)
}
for (const entry of readdirSync(tmpDir)) {
  if (path.join(tmpDir, entry) !== workDir) {
    remove(path.join(tmpDir, entry))
  }
}

if (command === 'deploy') {
  // 顺带清理已合并或关闭的 PR 的预览；清理出错不影响上线
  const open = openPullRequests(repoDir)
  if (open) await closeFinishedPreviews(previewsDir, open, say).catch((err: unknown) => say(`清理预览出错：${String(err)}`))
  const commit = git('rev-parse', 'HEAD')
  if (versionOf(binosDir) === commit) {
    say(`已经在运行 ${short(commit)}`)
    process.exit(0)
  }
  if (git('status', '--porcelain')) {
    say('注意：工作区有未提交的改动，不包含在这次构建里')
  }
  say(`构建 ${short(commit)}`)
  let build: string
  try {
    build = buildCommit(repoDir, commit, workDir)
  } catch (err) {
    writeFileSync(failedPath, commit + '\n')
    say(`✗ ${short(commit)} 构建失败，main 有新提交前不再自动上线它：${String(err)}`)
    process.exit(1)
  }
  await install(commit, build)
} else {
  await rollback()
}

async function install(commit: string, build: string) {
  const old = versionOf(binosDir)
  const dataBefore = existsSync(dataRevisionPath) ? readFileSync(dataRevisionPath, 'utf8') : ''
  installBuild(build, slots, aside)
  if (await restart(commit)) {
    rmSync(failedPath, { force: true })
    say(`✓ 正在运行 ${short(commit)}`)
    return
  }
  writeFileSync(failedPath, commit + '\n')
  say(`✗ ${short(commit)} 没有正常运行，main 有新提交前不再自动上线它，日志见 ${serverLog}`)
  const dataAfter = existsSync(dataRevisionPath) ? readFileSync(dataRevisionPath, 'utf8') : ''
  if (dataBefore !== dataAfter) {
    say('数据迁移已开始，保留新代码以便继续迁移或修复，不自动切回旧版本写入源数据')
    process.exitCode = 1
    return
  }
  undoInstall(slots, aside)
  if (old) {
    say((await restart(old)) ? `已切回 ${short(old)}` : `切回 ${short(old)} 后仍不正常，需要人工处理`)
  }
  process.exitCode = 1
}

// 和上一个版本交换。回退掉的版本记为失败，免得一分钟后又被自动上线
async function rollback() {
  const current = versionOf(binosDir)
  const previous = versionOf(slots.previous)
  if (!previous) {
    throw new Error('没有可以回退的版本')
  }
  swapPrevious(slots, aside)
  if (await restart(previous)) {
    if (current) {
      writeFileSync(failedPath, current + '\n')
    }
    say(`✓ 已回退到 ${short(previous)}，main 有新提交前不再自动上线 ${current ? short(current) : '原来的版本'}`)
    return
  }
  say(`✗ 回退到 ${short(previous)} 后没有正常运行，日志见 ${serverLog}`)
  swapPrevious(slots, aside)
  if (current) {
    say((await restart(current)) ? `已切回 ${short(current)}` : `切回 ${short(current)} 后仍不正常，需要人工处理`)
  }
  process.exitCode = 1
}

async function restart(commit: string) {
  execFileSync('launchctl', ['kickstart', '-k', `gui/${os.userInfo().uid}/${serverLabel}`])
  return isHealthy(serverPort, commit)
}

function remove(target: string) {
  try {
    rmSync(target, { recursive: true, force: true })
  } catch {
    // 删不掉的留给下一次
  }
}
