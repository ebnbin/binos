import { useSyncExternalStore } from 'react'
import type { ProviderInfo } from '@binos/protocol/apps/music'
import { onChange } from '../../events.ts'
import { listProviders } from './api.ts'

let state: { providers: ProviderInfo[]; error?: string } = { providers: [] }
const listeners = new Set<() => void>()
let generation = 0
export async function refreshProviders() {
  const current = ++generation
  try {
    const result = await listProviders()
    if (current === generation) state = result
  } catch (error) { if (current === generation) state = { ...state, error: error instanceof Error ? error.message : '无法读取音乐来源。' } }
  listeners.forEach(listener => listener())
}
const unsubscribe = onChange(event => { if (!event || event.type === 'music') void refreshProviders() })
void refreshProviders()
export function useProviders() {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => state)
}
if (import.meta.hot) import.meta.hot.dispose(unsubscribe)
