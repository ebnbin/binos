import { execFile } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { appDir, codeDir, isTestInstance } from '../../paths.js'
import { ApiException } from '../../errors.js'

const run = promisify(execFile)
export const repositoriesDir = path.join(appDir('code'), 'repositories')
export const repoDir = process.env.BINOS_REPO_DIR ?? (isTestInstance ? codeDir : path.join(repositoriesDir, 'binos', 'main'))

// 准备不了仓库：message 是给用户看的原因
export class RepositoryError extends ApiException {
  constructor(message: string) {
    super(400, 'invalid-input', message)
  }
}

export function parseRepository(value: string): string | undefined {
  const match = /^(?:https:\/\/github\.com\/|git@github\.com:)?([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(value.trim())
  return match && match[1]!.split('/').every((part) => part !== '.' && part !== '..') ? match[1] : undefined
}

export const projectRepoDir = (id: string) => path.join(repositoriesDir, id, 'main')

export async function cloneRepository(id: string, url: string, branch: string) {
  const directory = path.join(repositoriesDir, id)
  mkdirSync(directory, { recursive: true })
  const git = (args: string[]) => run('git', args, { cwd: directory, timeout: 120_000, maxBuffer: 4 * 1024 * 1024 })
  try {
    await git(['-c', 'credential.https://github.com.helper=!gh auth git-credential', 'clone', '--bare', '--', url, '.git'])
    await git(['config', 'credential.https://github.com.helper', '!gh auth git-credential'])
    await git(['config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*'])
    await git(['fetch', 'origin'])
    await git(['worktree', 'add', 'main', branch])
    await git(['branch', '--set-upstream-to', `origin/${branch}`, branch])
  } catch (error) {
    rmSync(directory, { recursive: true, force: true })
    throw error
  }
}

export async function prepareRepository(id: string, repository: string, create: boolean) {
  let created = false
  try {
    if (create) {
      await run('gh', ['repo', 'create', repository, '--private', '--add-readme'], { timeout: 60_000 })
      created = true
    }
    const { stdout } = await run('gh', ['repo', 'view', repository, '--json', 'nameWithOwner,defaultBranchRef,url'], { timeout: 30_000 })
    const info = JSON.parse(stdout) as { nameWithOwner: string; defaultBranchRef: { name: string } | null; url: string }
    if (!info.defaultBranchRef?.name) throw new RepositoryError('仓库还没有提交，请先在 GitHub 初始化仓库后再关联')
    await cloneRepository(id, info.url, info.defaultBranchRef.name)
    return { repository: info.nameWithOwner, defaultBranch: info.defaultBranchRef.name }
  } catch (error) {
    if (created) throw new RepositoryError(`GitHub 仓库 ${repository} 已创建，但本地初始化失败。请选择“关联已有仓库”重试`)
    if (error instanceof RepositoryError) throw error
    throw new RepositoryError('无法准备仓库，请检查 GitHub 登录、仓库名称和访问权限后重试')
  }
}
