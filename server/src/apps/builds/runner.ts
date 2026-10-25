import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, closeSync, openSync, writeFileSync } from 'node:fs'
import { lstat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { previewUrl } from '../../preview-info.js'
import { currentProcess, processStartTime } from '../../process.js'
import { targetArtifacts, targetScripts } from './types.js'
import type { Artifact, Target } from './types.js'

// 独立进程负责超时与进程组回收；构建服务更新不改变正在运行的脚本。
const [source, output, result, target, number, mode, pr] = process.argv.slice(2)
const script = targetScripts[target as Target]
await writeFile(path.join(path.dirname(result), 'runner.json'), JSON.stringify(currentProcess()))
let child: ReturnType<typeof spawn> | undefined
let cancelled = false
let timedOut = false
function kill() { if (child?.pid) { try { process.kill(-child.pid, 'SIGKILL') } catch { /* 进程已退出。 */ } } }
process.on('SIGTERM', () => { cancelled = true; kill() })
const timer = setTimeout(() => { timedOut = true; kill() }, 60 * 60_000)
let error: string | undefined
try {
  if (mode === 'mock') {
    await new Promise((resolve) => setTimeout(resolve, 1200))
    if (!cancelled) for (const spec of targetArtifacts[target as Target]) if (spec.kind === 'install') await writeFile(path.join(output, spec.name), `预览构建：${target}\n`)
  } else {
    const log = openSync(path.join(path.dirname(result), 'build.log'), 'a', 0o600)
    try {
      await new Promise<void>((resolve, reject) => {
        const command = script.endsWith('.sh') ? ['/bin/bash', script, target] : [process.execPath, script]
        child = spawn(command[0], command.slice(1), { cwd: source, detached: true, stdio: ['ignore', log, log], env: { ...process.env, BINOS_BUILD_OUTPUT: output, BINOS_BUILD_NUMBER: number, ...(pr && { BINOS_BUILD_PR: pr }) } })
        if (child.pid) {
          const startedAt = processStartTime(child.pid)
          if (startedAt) writeFileSync(path.join(path.dirname(result), 'child.json'), JSON.stringify({ pid: child.pid, startedAt }))
        }
        child.on('error', reject)
        child.on('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`构建退出：${code ?? signal}`)))
      })
    } finally { closeSync(log); kill() }
  }
} catch (e) { error = e instanceof Error ? e.message : String(e) }
clearTimeout(timer)
if (cancelled) error = '已取消'
if (timedOut) error = '构建超过 60 分钟'
const artifacts: Artifact[] = []
// 只收目标声明的产物，脚本留在产物目录里的其他文件不算；链接是 PR 预览的地址
if (!error) for (const spec of targetArtifacts[target as Target]) {
  if (spec.kind === 'link') { artifacts.push({ ...spec, url: previewUrl(Number(pr)) }); continue }
  const file = path.join(output, spec.name)
  const info = await lstat(file).catch(() => undefined)
  if (!info?.isFile()) { error = `构建没有生成 ${spec.name}`; break }
  const hasher = createHash('sha256')
  for await (const chunk of createReadStream(file)) hasher.update(chunk)
  artifacts.push({ ...spec, size: info.size, sha256: hasher.digest('hex') })
}
await writeFile(result + '.tmp', JSON.stringify({ status: cancelled ? 'cancelled' : error ? 'failed' : 'success', error, artifacts: error ? [] : artifacts, endedAt: new Date().toISOString() }))
const { rename } = await import('node:fs/promises')
await rename(result + '.tmp', result)
