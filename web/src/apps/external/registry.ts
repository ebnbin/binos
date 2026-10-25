import type { BuiltinApp, ExternalApp } from '@binos/server/types'
import { useSyncExternalStore } from 'react'
import { readApps, writeRegistry } from '../../api.ts'
import { onChange } from '../../events.ts'
import { iconNames } from './icons.ts'
import type { IconName } from './icons.ts'

export type ExternalAppConfig = Omit<ExternalApp, 'icon'> & { icon: IconName }

// 后端给出的全部 app：内置 app 的名称和注册表里的外部 app，整个页面共用一份。每次连上全局通知时（包括第一次）和收到 apps 通知时重新读取。
// 外部 app 的改动先在页面里生效，写入失败时重新读取，恢复成后端的
let external: ExternalAppConfig[] | undefined
let builtin: BuiltinApp[] | undefined
const listeners = new Set<() => void>()
let started = false
// 改动之前发出的读取，返回的是旧的清单，不用
let latest = 0

const notify = () => listeners.forEach((listener) => listener())

function refresh() {
  const request = ++latest
  void readApps().then((apps) => {
    if (apps && request === latest) {
      external = apps.external.map((app) => ({ ...app, icon: iconNames.includes(app.icon as IconName) ? (app.icon as IconName) : 'app-window' }))
      builtin = apps.builtin
      notify()
    }
  })
}

function subscribe(listener: () => void) {
  if (!started) {
    started = true
    onChange((event) => {
      if (event === null || event.type === 'apps') {
        refresh()
      }
    })
  }
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// 还没读到时返回 undefined
export function useExternalApps(): ExternalAppConfig[] | undefined {
  return useSyncExternalStore(subscribe, () => external)
}

export function useBuiltinApps(): BuiltinApp[] | undefined {
  return useSyncExternalStore(subscribe, () => builtin)
}

export function saveExternalApps(list: ExternalAppConfig[]) {
  latest++
  external = list
  notify()
  void writeRegistry({ external: list }).then((ok) => {
    if (!ok) {
      refresh()
    }
  })
}
