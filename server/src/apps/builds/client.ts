import { spawn } from 'node:child_process'
import { closeSync, mkdirSync, openSync } from 'node:fs'
import { createConnection } from 'node:net'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { dataDir, mock, socketPath, version } from './config.js'
import type { BuildRequest, BuildsSnapshot } from './types.js'
function send<T>(request: BuildRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath)
    let output = ''
    socket.setEncoding('utf8'); socket.setTimeout(150_000, () => socket.destroy(new Error('构建服务响应超时')))
    socket.on('connect', () => socket.write(JSON.stringify(request) + '\n'))
    socket.on('error', reject)
    socket.on('data', (chunk) => { output += chunk; if (output.length > 8 << 20) socket.destroy(new Error('响应过大')) })
    socket.on('end', () => {
      try { const reply = JSON.parse(output); if (!reply.ok) throw new Error(reply.error); resolve(reply.result) } catch (e) { reject(e) }
    })
  })
}
let starting: Promise<void> | undefined
async function ensure() {
  if (starting) return starting
  try {
    const status = await send<BuildsSnapshot>({ action: 'status' })
    if (status.mode !== (mock ? 'mock' : 'real')) throw new Error('构建服务模式不匹配')
    if (status.version === version) return
    // runner 独立于管理进程，切换版本时构建继续运行。
    try { await send({ action: 'handoff' }); await sleep(200) } catch { return }
  } catch (e) { if (!['ENOENT', 'ECONNREFUSED'].includes((e as NodeJS.ErrnoException).code ?? '')) throw e }
  starting = (async () => {
    mkdirSync(dataDir, { recursive: true })
    const log = openSync(path.join(dataDir, 'manager.log'), 'a', 0o600)
    try {
      const child = spawn(process.execPath, [...process.execArgv, path.join(import.meta.dirname, `daemon${path.extname(import.meta.filename)}`)], { env: process.env, stdio: ['ignore', log, log], detached: true })
      child.on('error', () => {}); child.unref()
    } finally { closeSync(log) }
    for (let i = 0; i < 80; i++) { await sleep(100); try { await send({ action: 'status' }); return } catch { /* 等待启动。 */ } }
    throw new Error('构建服务启动失败，请检查 manager.log')
  })().finally(() => { starting = undefined })
  return starting
}
export async function buildRequest<T = BuildsSnapshot>(request: BuildRequest): Promise<T> { await ensure(); return send<T>(request) }
