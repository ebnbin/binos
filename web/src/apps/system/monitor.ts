import type { MonitorStatus } from '@binos/server/apps/system/types'
import { useSyncExternalStore } from 'react'
import { errorMessage } from '../../api.ts'

const systemUrl = '/api/apps/system'
export async function systemRequest<T>(route: string, init?: RequestInit): Promise<T> {
  const response = await fetch(systemUrl + route, { ...init, signal: init?.signal || AbortSignal.timeout(12_000) })
  if (!response.ok) throw new Error(await errorMessage(response, '读取失败'))
  return (await response.json()) as T
}

type State = { status?: MonitorStatus; error?: string; lastSuccess: number; now: number }
let state: State = { lastSuccess: 0, now: Date.now() }
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setTimeout> | undefined
let pending: Promise<void> | undefined
let running = false
let generation = 0
function emit() {
  state = { ...state }
  listeners.forEach((listener) => listener())
}
export function refreshMonitor() {
  if (pending) return pending
  pending = (async () => {
    try {
      const status = await systemRequest<MonitorStatus>('/status')
      state = { status, lastSuccess: Date.now(), now: Date.now() }
    } catch (error) {
      state = { ...state, error: error instanceof Error ? error.message : String(error), now: Date.now() }
    } finally {
      pending = undefined
      emit()
    }
  })()
  return pending
}
function onVisible() {
  if (document.visibilityState === 'visible') void refreshMonitor()
}
function subscribe(listener: () => void) {
  listeners.add(listener)
  if (!running) {
    running = true
    const current = ++generation
    const poll = async () => {
      await refreshMonitor()
      if (running && current === generation) timer = setTimeout(() => void poll(), 5000)
    }
    void poll()
    document.addEventListener('visibilitychange', onVisible)
  }
  return () => {
    listeners.delete(listener)
    if (!listeners.size) {
      running = false
      generation++
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }
}
export function useMonitor() {
  return useSyncExternalStore(subscribe, () => state)
}
