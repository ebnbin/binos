import type { ChangeEvent } from '@binos/server/types'
import { useSyncExternalStore } from 'react'
import { eventsUrl, getVersion } from './api.ts'
import { connectEventSource } from './eventSource.ts'
import type { ConnectionProgress } from './eventSource.ts'

// 整个页面只连一条全局通知。每次连上时订阅者收到 null，表示之前可能漏了通知，应全部重新读取
type Listener = (event: ChangeEvent | null) => void

const listeners = new Set<Listener>()
const connectionListeners = new Set<() => void>()
let connected = true
let progress: ConnectionProgress = 'connecting'
// 页面打开期间上线了新版本。连接断开再连上通常就是后端重启了，这时比较版本
let updated = false
let version: string | undefined
let started = false

const notifyConnection = () => connectionListeners.forEach((listener) => listener())

async function checkVersion() {
  const current = await getVersion()
  if (current === undefined) {
    return
  }
  if (version === undefined) {
    version = current
  } else if (current !== version && !updated) {
    updated = true
    notifyConnection()
  }
}

function start() {
  if (started) {
    return
  }
  started = true
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
