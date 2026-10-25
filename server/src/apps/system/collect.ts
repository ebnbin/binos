import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { codeDir, isTestInstance } from '../../paths.js'
import { cpuUsage, parseNetwork, parseVm, parseVolumes } from './parsers.js'
import type { SystemSnapshot } from './types.js'

const exec = promisify(execFile)
async function command(file: string, args: string[] = []) {
  const { stdout } = await exec(file, args, { timeout: 4000, maxBuffer: 512 * 1024, env: { ...process.env, LANG: 'en_US.UTF-8', LC_ALL: 'C' } })
  return stdout.trim()
}

export class Collector {
  private previousCpu: { idle: number; total: number } | undefined
  private previousNet: { at: number; received: number; sent: number } | undefined
  private identity: Promise<{ model: string; chip: string; os: string; version: string }> | undefined

  async collect(): Promise<SystemSnapshot> {
    this.identity ??= Promise.all([
      command('/usr/sbin/sysctl', ['-n', 'hw.model']).catch(() => os.machine()),
      command('/usr/sbin/sysctl', ['-n', 'machdep.cpu.brand_string']).catch(() => os.cpus()[0]?.model || '未知'),
      command('/usr/bin/sw_vers', ['-productVersion']).catch(() => ''),
      readFile(path.join(codeDir, 'VERSION'), 'utf8').catch(() => 'dev'),
    ]).then(([model, chip, version, build]) => ({ model, chip, os: version ? `macOS ${version}` : 'macOS', version: build.trim() }))
    const unavailable: string[] = []
    async function read<T>(label: string, file: string, args: string[], parse: (text: string) => T, fallback: T) {
      try {
        return parse(await command(file, args))
      } catch {
        unavailable.push(label)
        return fallback
      }
    }
    const [identity, vm, pressure, volumes, counters, power] = await Promise.all([
      this.identity,
      read('内存详情', '/usr/bin/vm_stat', [], parseVm, { cached: null, wired: null, compressed: null }),
      read<SystemSnapshot['memory']['pressure']>(
        '内存压力',
        '/usr/sbin/sysctl',
        ['-n', 'kern.memorystatus_vm_pressure_level'],
        (text) => {
          if (text === '1') return 'normal'
          if (text === '2') return 'warning'
          if (text === '4') return 'critical'
          throw new Error('未知级别')
        },
        'unknown',
      ),
      read('存储', '/bin/df', ['-kP'], parseVolumes, []),
      read('网络速度', '/usr/sbin/netstat', ['-ibn'], parseNetwork, null),
      read(
        '供电',
        '/usr/bin/pmset',
        ['-g', 'batt'],
        (text) => {
          const source = /Now drawing from '([^']+)'/.exec(text)?.[1]
          if (!source) throw new Error('未知电源')
          return { source, battery: /\b(\d+)%/.test(text) ? Number(/\b(\d+)%/.exec(text)![1]) : null }
        },
        { source: '未知', battery: null },
      ),
    ])
    const at = Date.now()
    const cores = os.cpus()
    const cpu = cores.reduce((sum, core) => ({ idle: sum.idle + core.times.idle, total: sum.total + Object.values(core.times).reduce((a, b) => a + b, 0) }), {
      idle: 0,
      total: 0,
    })
    const percent = cpuUsage(this.previousCpu, cpu)
    this.previousCpu = cpu
    // 仅合计活动的物理网卡，避免 VPN 与回环接口重复计算流量。
    const physical = Object.keys(os.networkInterfaces()).filter((name) => /^en\d+$/.test(name))
    const traffic =
      counters && physical.some((name) => counters[name])
        ? physical.reduce((sum, name) => ({ received: sum.received + (counters[name]?.received || 0), sent: sum.sent + (counters[name]?.sent || 0) }), {
            received: 0,
            sent: 0,
          })
        : null
    const seconds = this.previousNet ? (at - this.previousNet.at) / 1000 : 0
    const rate = (key: 'received' | 'sent') =>
      traffic && this.previousNet && seconds > 0 && seconds < 30 && traffic[key] >= this.previousNet[key]
        ? (traffic[key] - this.previousNet[key]) / seconds
        : null
    const network = { receiveRate: rate('received'), sendRate: rate('sent') }
    this.previousNet = traffic ? { at, ...traffic } : undefined
    return {
      at,
      host: { name: os.hostname(), model: identity.model, chip: identity.chip, os: identity.os, uptime: os.uptime(), cores: cores.length },
      cpu: { percent },
      memory: { total: os.totalmem(), free: os.freemem(), cached: vm.cached, pressure },
      volumes: volumes.filter(
        (v) =>
          v.mount === '/System/Volumes/Data' ||
          (v.mount === '/' && !volumes.some((item) => item.mount === '/System/Volumes/Data')) ||
          /^\/Volumes\/[^./][^/]*$/.test(v.mount),
      ),
      network,
      power,
      runtime: { version: identity.version, uptime: process.uptime(), memory: process.memoryUsage().rss, test: isTestInstance },
      unavailable,
    }
  }
}
