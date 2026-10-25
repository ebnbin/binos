import { execFile, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { isRunning } from '../../process.js'
import type { ProcessIdentity } from '../../process.js'
import { automatic, mock, repository, resultsDir, statePath, version, workDir } from './config.js'
import type { Build, Request, Settings, Snapshot, Target } from './types.js'
const exec = promisify(execFile)
const now = () => new Date().toISOString()
const git = async (...args: string[]) => (await exec('git', args, { cwd: repository, timeout: 120_000, maxBuffer: 4 << 20 })).stdout.trim()
const read = <T>(file: string): T | undefined => { try { return JSON.parse(readFileSync(file, 'utf8')) as T } catch { return undefined } }
type State = { mode: string; builds: Build[]; settings: Settings; sequence: number }
export class Manager {
  private state: State
  private polling = false
  private ticking = false
  private active?: string
  private pollError?: string
  private checkedAt?: string
  constructor() {
    mkdirSync(resultsDir, { recursive: true }); mkdirSync(workDir, { recursive: true })
    const stored = read<State>(statePath)
    if (existsSync(statePath) && !stored) throw new Error('构建登记簿损坏，已停止以保留原数据')
    if (stored && stored.mode !== (mock ? 'mock' : 'real')) throw new Error('构建数据目录不能混用真实和模拟模式')
    this.state = stored ?? { mode: mock ? 'mock' : 'real', builds: [], settings: { automatic, adhoc: automatic }, sequence: 0 }
    this.active = this.state.builds.find((b) => b.status === 'running')?.id
    this.save()
  }
  private save() { writeFileSync(statePath + '.tmp', JSON.stringify(this.state, null, 2)); renameSync(statePath + '.tmp', statePath) }
  snapshot(): Snapshot { return { builds: [...this.state.builds].reverse(), settings: this.state.settings, mode: mock ? 'mock' : 'real', version, ...(this.pollError && { pollError: this.pollError }), ...(this.checkedAt && { checkedAt: this.checkedAt }) } }
  busy() { return this.ticking || this.polling || Boolean(this.active) }
  private enqueue(commit: string, targets: Target[], trigger: Build['trigger'], pr?: number, force = false) {
    for (const target of targets) {
      // 自动构建只看是否有过记录：取消和中断的构建不会被下一次检查重新排上，需手动重试。
      if (!force && this.state.builds.some((b) => b.commit === commit && b.target === target)) continue
      if (this.state.builds.some((b) => b.commit === commit && b.target === target && ['running', 'queued'].includes(b.status))) continue
      // 未开始的旧任务直接移出队列，来源回到该提交时仍会自动构建。
      if (trigger !== 'manual') this.state.builds = this.state.builds.filter((b) => !(b.status === 'queued' && b.trigger === trigger && b.pr === pr && b.target === target && b.commit !== commit))
      this.state.builds.push({ id: randomUUID(), commit, target, trigger, ...(pr && { pr }), status: 'queued', createdAt: now(), artifacts: [] })
    }
    this.save()
  }
  async request(request: Request) {
    switch (request.action) {
      case 'status': return this.snapshot()
      case 'handoff': if (this.ticking || this.polling) throw new Error('构建服务正在处理请求，请稍后更新'); return { ok: true }
      case 'stop': if (this.busy()) throw new Error('构建服务正忙，请等待或取消构建'); return { ok: true }
      case 'settings': this.state.settings = { automatic: request.automatic, adhoc: request.adhoc }; this.save(); return this.snapshot()
      case 'poll': await this.poll(); return this.snapshot()
      case 'enqueue': {
        let commit: string
        const pr = request.ref.startsWith('pr/') ? Number(request.ref.slice(3)) : undefined
        if (mock) commit = /^[a-f0-9]{40}$/.test(request.ref) ? request.ref : '0'.repeat(40)
        else {
          if (pr) {
            commit = (await git('ls-remote', 'origin', `refs/pull/${pr}/head`)).split(/\s/)[0]
            if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('找不到 PR 提交')
            await git('fetch', 'origin', commit)
          } else {
            if (request.ref === 'main') await git('fetch', 'origin', 'main')
            else await git('cat-file', '-e', `${request.ref}^{commit}`).catch(() => git('fetch', 'origin', request.ref))
            commit = await git('rev-parse', '--verify', `${request.ref === 'main' ? 'origin/main' : request.ref}^{commit}`)
          }
        }
        this.enqueue(commit, request.targets, 'manual', pr, true); return this.snapshot()
      }
      case 'retry': {
        const b = this.find(request.id)
        if (['queued', 'running'].includes(b.status)) throw new Error('构建还未结束')
        this.enqueue(b.commit, [b.target], 'manual', b.pr, true); return this.snapshot()
      }
      case 'cancel': {
        const b = this.find(request.id)
        if (b.status === 'running') {
          const identity = read<ProcessIdentity>(path.join(resultsDir, b.id, 'runner.json'))
          if (!identity || !isRunning(identity)) throw new Error('构建进程正在切换，请稍后重试')
          process.kill(identity.pid, 'SIGTERM')
        } else if (b.status === 'queued') { b.status = 'cancelled'; b.endedAt = now(); this.save() }
        else throw new Error('构建已结束')
        return this.snapshot()
      }
    }
  }
  private find(id: string) { const build = this.state.builds.find((b) => b.id === id); if (!build) throw new Error('找不到构建'); return build }
  async poll() {
    if (this.polling) return
    this.polling = true
    try {
      if (mock) { this.checkedAt = now(); return }
      await git('fetch', '--prune', 'origin')
      const commit = await git('rev-parse', 'origin/main')
      const selected: Target[] = ['android', 'ios-simulator', ...(this.state.settings.adhoc ? ['ios-adhoc' as const] : [])]
      // 只编含移动端脚本的提交，避免旧分支持续产生无意义的失败。
      const supported = async (sha: string) => git('cat-file', '-e', `${sha}:scripts/mobile-build.sh`).then(() => true, () => false)
      if (await supported(commit)) this.enqueue(commit, selected, 'main')
      const { stdout } = await exec('gh', ['pr', 'list', '--state', 'open', '--limit', '100', '--json', 'number,headRefOid,isCrossRepository'], { cwd: repository, timeout: 30_000 })
      const prs = JSON.parse(stdout) as { number: number; headRefOid: string; isCrossRepository: boolean }[]
      // 已关闭或合并的 PR 不再构建尚未开始的任务。
      this.state.builds = this.state.builds.filter((b) => !(b.status === 'queued' && b.trigger === 'pr' && !prs.some((pr) => pr.number === b.pr)))
      this.save()
      for (const pr of prs) {
        if (pr.isCrossRepository) continue
        await git('fetch', 'origin', `refs/pull/${pr.number}/head`)
        if (await supported(pr.headRefOid)) this.enqueue(pr.headRefOid, selected, 'pr', pr.number)
      }
      this.pollError = undefined; this.checkedAt = now()
    } catch (e) { this.pollError = e instanceof Error ? e.message : String(e) }
    finally { this.polling = false }
  }
  async tick() {
    if (this.ticking) return
    this.ticking = true
    try {
      if (this.active) {
        const b = this.find(this.active)
        const result = read<Pick<Build, 'status' | 'endedAt' | 'error' | 'artifacts'>>(path.join(resultsDir, b.id, 'result.json'))
        const identity = read<ProcessIdentity>(path.join(resultsDir, b.id, 'runner.json'))
        if (result) { Object.assign(b, result); this.save() }
        else if (identity && isRunning(identity)) return
        else if (Date.now() - Date.parse(b.startedAt!) < 10_000) return
        else {
          const child = read<ProcessIdentity>(path.join(resultsDir, b.id, 'child.json'))
          if (child && isRunning(child)) { try { process.kill(-child.pid, 'SIGKILL') } catch { /* 进程已结束。 */ } }
          b.status = 'interrupted'; b.error = '构建进程意外结束，可重试'; b.endedAt = now(); this.save() }
        await git('worktree', 'remove', '--force', path.join(workDir, b.id)).catch(() => {})
        await rm(path.join(workDir, b.id), { recursive: true, force: true, maxRetries: 3 })
        this.active = undefined
      }
      const b = this.state.builds.find((b) => b.status === 'queued')
      if (!b) return
      b.status = 'running'; b.startedAt = now(); this.active = b.id; this.state.sequence++; this.save()
      const source = path.join(workDir, b.id)
      const result = path.join(resultsDir, b.id)
      const output = path.join(result, 'outputs')
      try {
        await mkdir(output, { recursive: true })
        if (!mock) {
          await git('worktree', 'prune')
          await git('worktree', 'add', '--detach', source, b.commit)
        }
        const log = openSync(path.join(result, 'build.log'), 'a', 0o600)
        try {
          const child = spawn(process.execPath, [...process.execArgv, path.join(import.meta.dirname, `runner${path.extname(import.meta.filename)}`), source, output, path.join(result, 'result.json'), b.target, String(this.state.sequence), mock ? 'mock' : 'real'], { detached: true, stdio: ['ignore', log, log], env: process.env })
          child.on('error', (error) => { b.error = error.message; b.status = 'failed'; b.endedAt = now(); this.save() })
          child.unref()
        } finally { closeSync(log) }
      } catch (e) {
        b.status = 'failed'; b.error = e instanceof Error ? e.message : String(e); b.endedAt = now(); this.save()
        writeFileSync(path.join(result, 'result.json'), JSON.stringify({ status: b.status, error: b.error, endedAt: b.endedAt, artifacts: [] }))
      }
      await this.prune()
    } finally { this.ticking = false }
  }
  private async prune() {
    // 保留最近 50 次终态构建；删除不会触及正在排队或运行的记录。
    const finished = this.state.builds.filter((b) => !['queued', 'running'].includes(b.status))
    for (const b of finished.slice(0, Math.max(0, finished.length - 50))) {
      await rm(path.join(resultsDir, b.id), { recursive: true, force: true, maxRetries: 3 })
      this.state.builds = this.state.builds.filter((item) => item.id !== b.id)
    }
    this.save()
  }
  automatic() { return this.state.settings.automatic }
}
