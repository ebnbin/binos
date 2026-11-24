import type { AgentStatus } from '@binos/protocol/services/kita'
import { useSyncExternalStore } from 'react'
import { onChange } from '../../events.ts'
import { agentStatus } from './api.ts'

// agent 的额度和登录的状况，整个页面共用一份：有页面用到时读一次，之后收到 agent 通知（或者重新连上）时重新读
let status: AgentStatus | undefined
const listeners = new Set<() => void>()
let stop: (() => void) | undefined
let latest = 0

function refresh() {
  const request = ++latest
  void agentStatus().then((result) => {
    if (result && request === latest) {
      status = result
      listeners.forEach((listener) => listener())
    }
  })
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  stop ??= onChange((event) => {
    if (event === null || event.type === 'agent') {
      refresh()
    }
  })
  if (!status) {
    refresh()
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      stop?.()
      stop = undefined
    }
  }
}

export function useAgentStatus(): AgentStatus | undefined {
  return useSyncExternalStore(subscribe, () => status)
}
