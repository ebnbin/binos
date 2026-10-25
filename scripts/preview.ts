import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import type { BuildsSnapshot } from '../server/src/apps/builds/types.ts'
import { rootFromEnv, rootLayout } from '../server/src/layout.ts'
import { previewUrl } from '../server/src/preview-info.ts'

// 给出当前分支 PR 最新提交的预览；PR 合并或关闭后由构建服务和上线脚本删除
const { binosDir } = rootLayout(rootFromEnv())
const repoDir = path.resolve(import.meta.dirname, '..')

const git = (...args: string[]) => execFileSync('git', args, { cwd: repoDir, encoding: 'utf8' }).trim()
const short = (commit: string) => commit.slice(0, 7)

const fail = (message: string): never => {
  console.error(`✗ ${message}`)
  process.exit(1)
}

const branch = git('branch', '--show-current')
const commit = git('rev-parse', 'HEAD')
// 预览和 PR 里的代码一致：只预览已经推送的提交
let pushed: string | undefined
try {
  pushed = git('rev-parse', `refs/remotes/origin/${branch}`)
} catch {
  // 还没推送过
}
if (pushed !== commit) {
  fail(`本地 HEAD ${short(commit)} 还没有推送，先推送并开 PR`)
}
// 刚推送时 GitHub 上的 PR 要过几秒才更新到新提交
let pr = pullRequest()
for (let i = 0; i < 15 && pr?.state === 'OPEN' && pr.headRefOid !== commit; i++) {
  await sleep(2000)
  pr = pullRequest()
}
if (!pr) {
  fail(`分支 ${branch} 还没有 PR，先开 PR`)
}
const { number, state, headRefOid } = pr!
if (state !== 'OPEN') {
  fail(`PR #${number} 已经合并或关闭`)
}
if (headRefOid !== commit) {
  fail(`PR #${number} 最新的提交是 ${short(headRefOid)}，不是本地 HEAD ${short(commit)}`)
}

if (git('status', '--porcelain')) {
  console.log('注意：工作区有未提交的改动，不包含在预览里')
}

// 预览由构建服务的 Web 目标产出：让它马上检查 PR，等这个提交的 Web 构建结束
const cli = path.join(binosDir, 'bin', 'binos')
const builds = (...args: string[]) => JSON.parse(execFileSync(cli, ['builds', ...args], { encoding: 'utf8' })) as BuildsSnapshot
builds('poll')
console.log(`等待构建服务构建 ${short(commit)} 的预览`)
for (let i = 0; ; i++) {
  const build = builds('status').builds.find((b) => b.target === 'web' && b.commit === commit)
  if (!build) {
    fail(`构建服务没有为 ${short(commit)} 排上 Web 构建，用 binos builds status 查看`)
  }
  if (build!.status === 'success') {
    console.log(`✓ PR #${number} 的预览 ${short(commit)}：${previewUrl(number)}`)
    break
  }
  if (build!.status !== 'queued' && build!.status !== 'running') {
    fail(`${short(commit)} 的 Web 构建${build!.error ? `：${build!.error}` : '没有成功'}。日志用 binos builds log ${build!.id}，重试用 binos builds retry ${build!.id}`)
  }
  if (i === 600) {
    fail(`等了 30 分钟 ${short(commit)} 的 Web 构建还没结束，用 binos builds status 查看`)
  }
  await sleep(3000)
}

function pullRequest(): { number: number; state: string; headRefOid: string } | undefined {
  try {
    return JSON.parse(
      execFileSync('gh', ['pr', 'view', branch, '--json', 'number,state,headRefOid'], {
        cwd: repoDir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }),
    )
  } catch {
    return undefined
  }
}
