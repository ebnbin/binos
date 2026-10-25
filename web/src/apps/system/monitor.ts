import type { MonitorStatus } from '@binos/server/apps/system/types'
import { useSyncExternalStore } from 'react'
import { errorMessage } from '../../api.ts'
import { connectEventSource } from '../../eventSource.ts'

const systemUrl = '/api/apps/system'
export async function systemRequest<T>(route: string, init?: RequestInit): Promise<T> {
  const response = await fetch(systemUrl + route, { ...init, signal: init?.signal || AbortSignal.timeout(12_000) })
  if (!response.ok) throw new Error(await errorMessage(response, '读取失败'))
  return (await response.json()) as T
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
  close ??= connectEventSource(() => `${systemUrl}/stream`, {
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
