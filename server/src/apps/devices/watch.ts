import { mkdirSync, readFileSync, watch } from 'node:fs'
import path from 'node:path'
import { notifyChange } from '../../events.js'
import { dataDir, statePath } from './config.js'
import type { State } from './types.js'

// 页面上看得到的内容：租约和排队的保活时间（lastSeen）每次续租都变，不算
function visible(): string | undefined {
  try {
    const { devices, leases, queue, events } = JSON.parse(readFileSync(statePath, 'utf8')) as State
    const alive = (item: { lastSeen: number }) => ({ ...item, lastSeen: 0 })
    return JSON.stringify([devices, leases.map(alive), queue.map(alive), events])
  } catch {
    return undefined
  }
}

// 设备服务是独立进程，登记簿每次改动都整体替换；后端看到替换、页面上看得到的内容变了，就通知页面重新读取
export function watchDevices() {
  mkdirSync(dataDir, { recursive: true })
  let last = visible()
  let timer: NodeJS.Timeout | undefined
  watch(dataDir, (_event, name) => {
    if (name !== path.basename(statePath)) return
    clearTimeout(timer)
    timer = setTimeout(() => {
      const current = visible()
      if (current !== last) notifyChange({ type: 'devices' })
      last = current
    }, 100)
  }).on('error', console.error).unref()
}
