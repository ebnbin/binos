import { execFileSync } from 'node:child_process'
import { rootFromEnv, rootLayout } from '../server/src/layout.ts'
import { previewUrl } from '../server/src/preview-info.ts'
import { deployPreview } from './previews.ts'

// Web 目标的构建命令：构建服务在这个提交的临时 worktree 里运行它，把提交构建成 PR 的预览，产物是预览的链接
const number = Number(process.env.BINOS_BUILD_PR)
if (!Number.isInteger(number) || number < 1) {
  throw new Error('Web 只构建 PR 的提交，需要 BINOS_BUILD_PR')
}
const { previewsDir, agentsDir } = rootLayout(rootFromEnv())
const run = (command: string, ...args: string[]) => execFileSync(command, args, { encoding: 'utf8' }).trim()
const commit = run('git', 'rev-parse', 'HEAD')

// 临时 worktree 构建完就删除；预览里的 agent 在本机这个 PR 分支的 worktree 里工作，没有时用目标分支的
const { headRefName, baseRefName } = JSON.parse(run('gh', 'pr', 'view', String(number), '--json', 'headRefName,baseRefName')) as { headRefName: string; baseRefName: string }
const worktrees = new Map<string, string>()
for (const block of run('git', 'worktree', 'list', '--porcelain').split('\n\n')) {
  const dir = /^worktree (.+)$/m.exec(block)?.[1]
  const branch = /^branch refs\/heads\/(.+)$/m.exec(block)?.[1]
  if (dir && branch) worktrees.set(branch, dir)
}
const agentRepo = worktrees.get(headRefName) ?? worktrees.get(baseRefName)
if (!agentRepo) {
  throw new Error(`本机没有 ${headRefName} 或 ${baseRefName} 分支的 worktree`)
}

await deployPreview({ previewsDir, agentsDir: process.env.BINOS_AGENTS_DIR ?? agentsDir, sourceRepo: process.cwd(), agentRepo, number, commit, say: console.log })
console.log(`PR #${number} 的预览：${previewUrl(number)}`)
