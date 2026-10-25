import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import { deviceRequest } from './client.js'
import { platforms } from './protocol.js'
import type { DeviceScreenshot, LeaseResult, Snapshot } from './types.js'

const argv = process.argv.slice(2)
const command = argv.shift()
const separator = argv.indexOf('--')
const options = separator < 0 ? argv : argv.slice(0, separator)
const flag = (name: string) => { const at = options.indexOf(`--${name}`); return at >= 0 ? options[at + 1] : undefined }
const owner = flag('session') ?? process.env.BINOS_THREAD_ID
const identity = () => { if (!owner) throw new Error('需要 BINOS_THREAD_ID 或 --session <身份>'); return owner }
const lease = () => { const value = flag('lease'); if (!value) throw new Error('需要 --lease <申请返回的租约 ID>'); return value }
const print = (value: unknown) => console.log(JSON.stringify(value, null, 2))

try {
  switch (command) {
    case 'status': print(await deviceRequest({ action: 'status' })); break
    case 'discover': print(await deviceRequest({ action: 'discover' })); break
    case 'acquire': {
      const selected = platforms(flag('platform') ?? 'both')
      const seconds = Number(flag('wait') ?? 0)
      if (!Number.isFinite(seconds) || seconds < 0 || seconds > 600) throw new Error('--wait 范围为 0 到 600 秒')
      const until = Date.now() + seconds * 1000
      let requestId: string = flag('request') ?? randomUUID()
      let result: LeaseResult
      let pending = true
      do {
        result = await deviceRequest<LeaseResult>({ action: 'acquire', owner: identity(), reason: flag('reason') ?? '', platforms: selected, requestId })
        requestId = result.requestId
        if (result.error || result.lease || Date.now() >= until) break
        await sleep(2000)
        pending = Date.now() <= until
      } while (pending)
      print(result)
      if (!result.lease) process.exitCode = result.error ? 1 : 2
      break
    }
    case 'renew': case 'release': print(await deviceRequest({ action: command, owner: identity(), lease: lease() })); break
    case 'cancel': {
      const requestId = flag('request')
      if (!requestId) throw new Error('需要 --request <申请编号>')
      print(await deviceRequest({ action: 'cancel', owner: identity(), requestId })); break
    }
    case 'screenshot': {
      const result = await deviceRequest<DeviceScreenshot>({ action: 'screenshot', device: argv[0], owner: identity(), lease: lease() })
      const output = flag('output')
      if (!output) throw new Error('需要 --output <截图文件>')
      writeFileSync(output, Buffer.from(result.image, 'base64'))
      print({ output, mime: result.mime, at: result.at })
      break
    }
    case 'run': {
      const at = argv.indexOf('--')
      if (at < 0 || !argv[at + 1]) throw new Error('用法：run --lease <id> -- <命令> [参数]')
      const result = await deviceRequest<{ code: number; stdout: string; stderr: string }>({ action: 'run', owner: identity(), lease: lease(), command: argv.slice(at + 1), cwd: process.cwd(), timeout: Number(flag('timeout') ?? 1800) * 1000 })
      process.stdout.write(result.stdout)
      process.stderr.write(result.stderr)
      process.exitCode = result.code
      break
    }
    case 'env': {
      const status = await deviceRequest<LeaseResult>({ action: 'renew', owner: identity(), lease: lease() })
      print(status.env)
      break
    }
    case 'log': { const status = await deviceRequest<Snapshot>({ action: 'status' }); print(status.events); break }
    case undefined: case 'help': case '--help':
      console.log(`用法：binos devices <命令>
  status | discover | log              查看设备池、只读发现已有模拟器、操作记录
  acquire --platform android|ios|both [--reason 用途] [--wait 秒] [--request 申请编号]
  renew | release --lease <id>          续租或释放，归还后自动清理
  cancel --request <申请编号>            取消等待中的申请
  env --lease <id>                      输出设备环境变量 JSON
  run --lease <id> [--timeout 秒] -- <命令> [参数]
  screenshot <设备ID> --lease <id> --output <文件>
身份默认使用 BINOS_THREAD_ID，手动操作加 --session <身份>。
设备按需创建，总容量 4 台；双端就绪后整组交付。闲置一小时后销毁。
同一会话持有设备时不能追加申请，改变平台必须先归还。
测试实例使用模拟设备，不接管已有模拟器。
受管理命令自动保活，最长 30 分钟；其他操作间隔较长时使用 renew。`)
      break
    default: throw new Error(`未知设备命令：${command}`)
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
