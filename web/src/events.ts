import type { ChangeEvent } from '@binos/protocol/core'
import { useSyncExternalStore } from 'react'
import { eventsUrl, readVersions } from './api.ts'
import { connectEventSource } from './eventSource.ts'
import type { ConnectionProgress } from './eventSource.ts'

// 整个页面只连一条全局通知。每次连上时订阅者收到 null，表示之前可能漏了通知，应全部重新读取
type Listener = (event: ChangeEvent | null) => void

const listeners = new Set<Listener>()
const connectionListeners = new Set<() => void>()
let connected = true
let progress: ConnectionProgress = 'connecting'
// 页面打开期间上线了新的页面，或者后端换了协议。页面和后端各自上线：后端重启后会重连，这时比较；
// 只换页面时后端不重启，所以切回页面时和每隔一段时间也比较
let updated = false
let loaded: { web?: string; protocol?: string } | undefined
let started = false
const checkInterval = 5 * 60_000

const notifyConnection = () => connectionListeners.forEach((listener) => listener())

async function checkVersion() {
  const current = await readVersions()
  // 第一次读到的是页面打开时的版本
  const opened = { web: loaded?.web ?? current.web, protocol: loaded?.protocol ?? current.protocol }
  loaded = opened
  const changed = (key: 'web' | 'protocol') => current[key] !== undefined && current[key] !== opened[key]
  if ((changed('web') || changed('protocol')) && !updated) {
    updated = true
    notifyConnection()
  }
}

function start() {
  if (started) {
    return
  }
  started = true
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void checkVersion()
  })
  setInterval(() => void checkVersion(), checkInterval)
  connectEventSource(eventsUrl, {
    onOpen: () => {
      void checkVersion()
      listeners.forEach((listener) => listener(null))
    },
    onMessage: (data) => {
      const event: ChangeEvent = JSON.parse(data)
      listeners.forEach((listener) => listener(event))
    },
    onConnectedChange: (value) => {
      connected = value
      notifyConnection()
    },
    onProgress: (value) => {
      progress = value
      notifyConnection()
    },
  })
}

export function onChange(listener: Listener): () => void {
  listeners.add(listener)
  start()
  return () => listeners.delete(listener)
}

function subscribeConnection(listener: () => void) {
  connectionListeners.add(listener)
  start()
  return () => connectionListeners.delete(listener)
}

export function useConnected(): boolean {
  return useSyncExternalStore(subscribeConnection, () => connected)
}

// 一个圆点能表示的连接状态。设备离线时连不连得上无从判断，优先于连接的进展；连着的时候有新版本才显示有新版本
export type ConnectionState = 'connected' | 'connecting' | 'failed' | 'offline' | 'updated'

function subscribeState(listener: () => void) {
  window.addEventListener('online', listener)
  window.addEventListener('offline', listener)
  const unsubscribe = subscribeConnection(listener)
  return () => {
    window.removeEventListener('online', listener)
    window.removeEventListener('offline', listener)
    unsubscribe()
  }
}

function readState(): ConnectionState {
  if (!navigator.onLine) {
    return 'offline'
  }
  if (progress !== 'open') {
    return progress
  }
  return updated ? 'updated' : 'connected'
}

export function useConnectionState(): ConnectionState {
  return useSyncExternalStore(subscribeState, readState)
}
