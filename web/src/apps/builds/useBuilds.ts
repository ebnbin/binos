import type { Build, Snapshot } from '@binos/server/apps/builds/types'
import { useCallback, useEffect, useRef, useState } from 'react'
import { onChange } from '../../events.ts'

export const buildsBase = '/api/apps/builds'

export async function buildsRequest(body?: unknown): Promise<Snapshot> {
  const r = await fetch(buildsBase, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined)
  const data = await r.json()
  if (!r.ok) throw new Error(data.error ?? '请求失败')
  return data
}

// 构建状态变化时后端发 builds 通知；重新连上和切回页面时也重读，补上可能漏掉的通知
export function useBuilds(enabled = true) {
  const [data, setData] = useState<Snapshot>()
  const [error, setError] = useState('')
  const latest = useRef(0)
  const load = useCallback(async () => {
    const version = ++latest.current
    try { const result = await buildsRequest(); if (latest.current === version) { setData(result); setError('') } }
    catch (e) { if (latest.current === version) setError(String(e)) }
  }, [])
  const update = useCallback((result: Snapshot) => { latest.current++; setData(result) }, [])
  useEffect(() => {
    if (!enabled) return
    const initial = setTimeout(() => void load(), 0)
    const stop = onChange((event) => { if (event === null || event.type === 'builds') void load() })
    const visible = () => { if (!document.hidden) void load() }
    document.addEventListener('visibilitychange', visible)
    return () => { clearTimeout(initial); stop(); document.removeEventListener('visibilitychange', visible) }
  }, [enabled, load])
  return { data, error, setError, update }
}

export type BuildState = 'running' | 'failed' | 'success'

// 一组构建合起来的状态：还有没编完的算构建中，有失败或中断的算失败；只有取消的不算
export function buildState(builds: Build[]): BuildState | undefined {
  if (builds.some((b) => b.status === 'queued' || b.status === 'running')) return 'running'
  if (builds.some((b) => b.status === 'failed' || b.status === 'interrupted')) return 'failed'
  if (builds.some((b) => b.status === 'success')) return 'success'
}

// 这个 PR 最新提交的构建，包括手动指定 pr/编号 的
export function prBuilds(builds: Build[], pr: number) {
  const commit = builds.find((b) => b.pr === pr)?.commit
  return builds.filter((b) => b.pr === pr && b.commit === commit)
}

// 侧栏的概况：有在编的显示个数；否则显示最近编完的那个提交的结果
export function buildsSummary(builds: Build[]): { text: string; state: BuildState } | undefined {
  const running = builds.filter((b) => b.status === 'running').length
  const queued = builds.filter((b) => b.status === 'queued').length
  if (running || queued) return { text: [running && `${running} 个构建中`, queued && `${queued} 个排队`].filter(Boolean).join(' · '), state: 'running' }
  const last = builds.filter((b) => b.endedAt && b.status !== 'cancelled').sort((a, b) => b.endedAt!.localeCompare(a.endedAt!))[0]
  if (!last) return
  const state = buildState(builds.filter((b) => b.commit === last.commit && b.trigger === last.trigger && b.pr === last.pr))!
  return { text: `${last.trigger === 'main' ? 'main' : last.pr ? `PR #${last.pr}` : '手动'} ${state === 'failed' ? '构建失败' : '构建成功'}`, state }
}
