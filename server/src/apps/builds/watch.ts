import { mkdirSync, watch } from 'node:fs'
import { notifyChange } from '../../events.js'
import { dataDir } from './config.js'

// 构建服务是独立进程，登记簿每次改动都整体替换；后端看到替换就通知页面重新读取。
export function watchBuilds() {
  mkdirSync(dataDir, { recursive: true })
  let timer: NodeJS.Timeout | undefined
  watch(dataDir, (_event, name) => {
    if (name !== 'state.json') return
    clearTimeout(timer)
    timer = setTimeout(() => notifyChange({ type: 'builds' }), 100)
  }).on('error', console.error).unref()
}
