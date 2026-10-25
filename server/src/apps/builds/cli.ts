import { open } from 'node:fs/promises'
import path from 'node:path'
import { buildRequest } from './client.js'
import { resultsDir } from './config.js'
import { parseRequest } from './protocol.js'
const [action, ...args] = process.argv.slice(2)
try {
  if (action === 'serve') await import('./daemon.js')
  else if (['status', 'poll', 'stop'].includes(action)) console.log(JSON.stringify(await buildRequest(parseRequest({ action })), null, 2))
  else if (action === 'enqueue') console.log(JSON.stringify(await buildRequest(parseRequest({ action, ref: args[0] ?? 'main', targets: (args[1] ?? 'android,ios').split(',') })), null, 2))
  else if (action === 'cancel' || action === 'retry') console.log(JSON.stringify(await buildRequest(parseRequest({ action, id: args[0] })), null, 2))
  else if (action === 'log') {
    if (!/^[a-f0-9-]{36}$/.test(args[0] ?? '')) throw new Error('需要构建ID')
    const lines = Number(args[1] ?? 200)
    if (!Number.isInteger(lines) || lines < 1) throw new Error('行数无效')
    const file = await open(path.join(resultsDir, args[0], 'build.log'), 'r').catch(() => { throw new Error('找不到构建日志') })
    try {
      // 从末尾往前读，读够行数为止，不载入整个日志。
      const size = (await file.stat()).size
      let start = size; let tail = Buffer.alloc(0)
      while (start > 0 && tail.filter((byte) => byte === 10).length <= lines) {
        const length = Math.min(start, 256 * 1024); start -= length
        const buffer = Buffer.alloc(length); await file.read(buffer, 0, length, start)
        tail = Buffer.concat([buffer, tail])
      }
      process.stdout.write(tail.toString().replace(/\n$/, '').split('\n').slice(-lines).join('\n') + '\n')
    } finally { await file.close() }
  }
  else console.log('用法：binos builds status|poll|serve|stop\n  enqueue main|pr/<编号>|<完整提交> [android,ios]\n  cancel|retry <构建ID>\n  log <构建ID> [行数，默认 200]')
} catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exitCode = 1 }
