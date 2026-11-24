import type { MonitorStatus } from '@binos/protocol/apps/system'
import { useSyncExternalStore } from 'react'
import { apiUrl, readJson, request } from '../../api.ts'
import { connectEventSource } from '../../eventSource.ts'

// 立即重新采样一次
export async function refreshMonitor() {
  return readJson(await request('POST /api/apps/system/refresh', { signal: AbortSignal.timeout(12_000) }), '读取失败')
}

// 后端每采样一次推送一次；有页面在看时才连着
type State = { status?: MonitorStatus; error?: string; lastSuccess: number; now: number }
let state: State = { lastSuccess: 0, now: Date.now() }
const listeners = new Set<() => void>()
let close: (() => void) | undefined
function emit(next: State) {
  state = next
  listeners.forEach((listener) => listener())
}
function subscribe(listener: () => void) {
  listeners.add(listener)
  close ??= connectEventSource(() => apiUrl('GET /api/apps/system/stream').href, {
    onMessage: (data) => emit({ status: JSON.parse(data) as MonitorStatus, lastSuccess: Date.now(), now: Date.now() }),
    onConnectedChange: (connected) => {
      if (!connected) emit({ ...state, error: '监控连接中断', now: Date.now() })
    },
  })
  return () => {
    listeners.delete(listener)
    if (!listeners.size) {
      close?.()
      close = undefined
    }
  }
}
export function useMonitor() {
  return useSyncExternalStore(subscribe, () => state)
}
