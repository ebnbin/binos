import type { CommandResult, PlayerMessage, PlayerReport } from '@binos/protocol/apps/music'
import { apiUrl, request } from '../../api.ts'
import type { MusicController } from './controller.ts'
import { executePlayerCommand, playerState } from './playerCommands.ts'

export function connectPlayer(music: MusicController, refreshQueue: () => Promise<boolean>) {
  let closed = false
  let playerId: string | undefined
  let generation = new AbortController()
  let reports = Promise.resolve()
  let changed = true
  let busy = false
  let stateReportPending = false
  const label = /Android/i.test(navigator.userAgent) ? 'Android' : /iPhone|iPad/i.test(navigator.userAgent) ? 'iOS' : /Macintosh/i.test(navigator.userAgent) ? 'Mac 浏览器' : '浏览器'
  const source = new EventSource(apiUrl('GET /api/apps/music/players/connect', { query: { label } }))
  const report = (result?: PlayerReport['result']) => {
    const id = playerId
    if (!id || closed || !result && stateReportPending) return Promise.resolve()
    if (!result) stateReportPending = true
    reports = reports.catch(() => {}).then(async () => {
      if (id !== playerId || closed) return
      const response = await request('POST /api/apps/music/players/:id/report', {
        params: { id }, signal: AbortSignal.timeout(5000),
        json: { state: playerState(music), ...(result && { result }) },
      })
      if (!response.ok) throw new Error('播放器状态同步失败。')
    }).finally(() => { if (!result) stateReportPending = false })
    return reports
  }
  const execute = async (command: CommandResult) => {
    const signal = generation.signal
    let error: string | undefined
    let acquired = false
    try {
      if (signal.aborted) return
      if (busy) throw new Error('播放器正在执行另一条指令。')
      busy = true
      acquired = true
      if (!await refreshQueue()) throw new Error('共享队列尚未同步，请重试。')
      // 服务端确认期限，避免设备时钟偏差或网络缓冲导致执行过期指令。
      const latest = await request('GET /api/apps/music/commands/:id', { params: { id: command.id }, signal: AbortSignal.timeout(3000) })
      if (!latest.ok || (await latest.json()).status !== 'pending' || signal.aborted) return
      await executePlayerCommand(music, command.command, signal)
    } catch (reason) {
      error = (reason instanceof Error ? reason.message : '播放指令执行失败。').slice(0, 2000)
    } finally {
      if (acquired && signal === generation.signal) busy = false
    }
    if (!signal.aborted) await report({ id: command.id, ...(error && { error }) })
  }
  source.onmessage = event => {
    const message = JSON.parse(event.data) as PlayerMessage
    if (message.type === 'connected') {
      generation.abort()
      generation = new AbortController()
      busy = false
      playerId = message.playerId
      void report().catch(() => {})
    } else if (message.type === 'command') void execute(message.command).catch(() => {})
  }
  source.onerror = () => { playerId = undefined; generation.abort() }
  const unsubscribe = music.subscribe(() => { changed = true })
  const timer = setInterval(() => {
    if (changed) { changed = false; void report().catch(() => { changed = true }) }
  }, 1000)
  const heartbeat = setInterval(() => { void report().catch(() => {}) }, 10000)
  return () => {
    closed = true
    generation.abort()
    source.close()
    unsubscribe()
    clearInterval(timer)
    clearInterval(heartbeat)
  }
}
