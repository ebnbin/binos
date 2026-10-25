import { notifyChange } from '../../events.js'
import { listSessions } from './sessions.js'

// 终端会话也可能在 binOS 之外结束（比如 shell 里 exit），隔一会儿看一次 tmux 的会话列表，变了才通知
const interval = 5000
let last: string | undefined
let timer: ReturnType<typeof setInterval> | undefined

export async function checkTerminals() {
  const ids = JSON.stringify((await listSessions().catch(() => [])).map((session) => session.id))
  if (last !== undefined && ids !== last) notifyChange({ type: 'terminal' })
  last = ids
}

export function watchTerminals() {
  if (timer) return
  void checkTerminals()
  timer = setInterval(() => void checkTerminals(), interval)
  timer.unref()
}

export function stopWatchingTerminals() {
  clearInterval(timer)
  timer = undefined
}
