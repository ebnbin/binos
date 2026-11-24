import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { rootFromEnv, rootLayout } from '../server/src/layout.ts'
import { acquireProcessLock } from '../server/src/process.ts'
import { serverLabel, serverPort } from '../server/src/production.ts'
import { buildUnits, isServerHealthy, isWebHealthy } from './build.ts'
import { installBuild, swapPrevious, undoInstall, versionOf } from './install.ts'
import type { Slots } from './install.ts'
import { closeFinishedPreviews } from '../server/src/preview-instances.ts'
import { openPullRequests } from './previews.ts'
import { needsDeploy, units } from './units.ts'
import type { Unit } from './units.ts'

const { binosDir, webDir, deployDir, logsDir, previewsDir, dataRevisionPath } = rootLayout(rootFromEnv())
const repoDir = path.resolve(import.meta.dirname, '..')
const serverLog = path.join(logsDir, 'server.log')
const tmpDir = path.join(deployDir, 'tmp')
// main 停在这个提交时不再自动上线：它上线失败过，或者被回退了
const failedPath = path.join(deployDir, 'failed')
// 已经上线的 main 的提交。两端各自记着自己的版本，只改了一端的提交只上线那一端
const deployedPath = path.join(deployDir, 'deployed')
// 上一次上线换了哪几端，回退时只换回这几端
const lastPath = path.join(deployDir, 'last.json')
const slots: Record<Unit, Slots> = {
  server: { current: binosDir, previous: path.join(deployDir, 'previous') },
  web: { current: webDir, previous: path.join(deployDir, 'previous-web') },
}

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
  if (readText(deployedPath) === commit) {
    say(`已经在运行 ${short(commit)}`)
    process.exit(0)
  }
  if (git('status', '--porcelain')) {
    say('注意：工作区有未提交的改动，不包含在这次构建里')
  }
  const changed = units.filter((unit) => needsDeploy(unit, changedFiles(versionOf(slots[unit].current), commit)))
  if (!changed.length) {
    writeFileSync(deployedPath, commit + '\n')
    say(`${short(commit)} 没有改动正式版运行的代码`)
    process.exit(0)
  }
  say(`构建 ${short(commit)}，上线 ${changed.join('、')}`)
  let build: Record<Unit, string>
  try {
    build = buildUnits(repoDir, commit, workDir)
  } catch (err) {
    writeFileSync(failedPath, commit + '\n')
    say(`✗ ${short(commit)} 构建失败，main 有新提交前不再自动上线它：${String(err)}`)
    process.exit(1)
  }
  await install(commit, changed, build)
} else {
  await rollback()
}

// 一端上一次上线的提交到新提交改了哪些文件；没上线过、或者读不到那个提交时是 undefined。
// 自动上线的仓库是只有最新提交的浅克隆，先取来那个提交
function changedFiles(from: string | undefined, to: string) {
  if (!from) return undefined
  if (from === to) return []
  try {
    try {
      execFileSync('git', ['cat-file', '-e', `${from}^{commit}`], { cwd: repoDir, stdio: 'ignore' })
    } catch {
      git('fetch', '--quiet', '--depth', '1', 'origin', from)
    }
    return git('diff', '--name-only', from, to).split('\n').filter(Boolean)
  } catch {
    return undefined
  }
}

// 先装上要换的几端，后端换了就重启，再检查换了的每一端都在运行新提交。不正常时换回原来的版本
async function install(commit: string, changed: Unit[], build: Record<Unit, string>) {
  const old = versionOf(binosDir)
  const dataBefore = existsSync(dataRevisionPath) ? readFileSync(dataRevisionPath, 'utf8') : ''
  for (const unit of changed) installBuild(build[unit], slots[unit], path.join(aside, unit))
  if (await healthy(changed, commit)) {
    rmSync(failedPath, { force: true })
    writeFileSync(deployedPath, commit + '\n')
    writeFileSync(lastPath, JSON.stringify({ units: changed }) + '\n')
    say(`✓ 正在运行 ${short(commit)}`)
    return
  }
  writeFileSync(failedPath, commit + '\n')
  say(`✗ ${short(commit)} 没有正常运行，main 有新提交前不再自动上线它，日志见 ${serverLog}`)
  const dataAfter = existsSync(dataRevisionPath) ? readFileSync(dataRevisionPath, 'utf8') : ''
  if (changed.includes('server') && dataBefore !== dataAfter) {
    say('数据迁移已开始，保留新代码以便继续迁移或修复，不自动切回旧版本写入源数据')
    process.exitCode = 1
    return
  }
  for (const unit of changed) undoInstall(slots[unit], path.join(aside, unit))
  if (changed.includes('server') && old) {
    say((await restart(old)) ? `已切回 ${short(old)}` : `切回 ${short(old)} 后仍不正常，需要人工处理`)
  } else {
    say('已切回原来的页面')
  }
  process.exitCode = 1
}

// 把上一次上线换掉的几端和上一个版本交换。回退掉的提交记为失败，免得一分钟后又被自动上线
async function rollback() {
  const swapped = readJson<{ units: Unit[] }>(lastPath)?.units ?? ['server']
  const current = readText(deployedPath) ?? versionOf(binosDir)
  const previous = Object.fromEntries(swapped.map((unit) => [unit, versionOf(slots[unit].previous)])) as Partial<Record<Unit, string>>
  if (swapped.some((unit) => !previous[unit])) {
    throw new Error('没有可以回退的版本')
  }
  for (const unit of swapped) swapPrevious(slots[unit], path.join(aside, unit))
  if (await healthy(swapped, previous)) {
    if (current) {
      writeFileSync(failedPath, current + '\n')
    }
    say(`✓ 已回退 ${swapped.join('、')}，main 有新提交前不再自动上线 ${current ? short(current) : '原来的版本'}`)
    return
  }
  say(`✗ 回退后没有正常运行，日志见 ${serverLog}`)
  for (const unit of swapped) swapPrevious(slots[unit], path.join(aside, unit))
  const back = Object.fromEntries(swapped.map((unit) => [unit, versionOf(slots[unit].current)])) as Partial<Record<Unit, string>>
  say((await healthy(swapped, back)) ? '已切回原来的版本' : '切回原来的版本后仍不正常，需要人工处理')
  process.exitCode = 1
}

// 换了的每一端都在运行期望的提交：commit 是一个提交，或者每一端各自的提交
async function healthy(changed: Unit[], commit: string | Partial<Record<Unit, string>>) {
  const expected = (unit: Unit) => (typeof commit === 'string' ? commit : commit[unit]!)
  if (changed.includes('server') && !(await restart(expected('server')))) return false
  return !changed.includes('web') || isWebHealthy(serverPort, expected('web'))
}

async function restart(commit: string) {
  execFileSync('launchctl', ['kickstart', '-k', `gui/${os.userInfo().uid}/${serverLabel}`])
  return isServerHealthy(serverPort, commit)
}

function readText(file: string) {
  try {
    return readFileSync(file, 'utf8').trim()
  } catch {
    return undefined
  }
}

function readJson<T>(file: string) {
  const text = readText(file)
  return text === undefined ? undefined : (JSON.parse(text) as T)
}

function remove(target: string) {
  try {
    rmSync(target, { recursive: true, force: true })
  } catch {
    // 删不掉的留给下一次
  }
}
