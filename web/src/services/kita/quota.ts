import type { Limits, QuotaWindow } from '@binos/protocol/services/kita'
import { useEffect, useState } from 'react'

const hour = 3600_000
const weekday = new Intl.DateTimeFormat('zh-CN', { weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

// 窗口的名字：5 小时、7 天，同样长的窗口不止一个时带上它的 label
function windowName(window: QuotaWindow) {
  const { minutes } = window
  const length = minutes % (24 * 60) === 0 ? `${minutes / 24 / 60} 天` : minutes % 60 === 0 ? `${minutes / 60} 小时` : `${minutes} 分钟`
  return window.label ? `${window.label} ${length}` : length
}

// 多久：45 分钟、3 小时、2 天
export function formatSpan(ms: number) {
  const minutes = Math.max(Math.round(ms / 60_000), 1)
  if (minutes < 60) {
    return `${minutes} 分钟`
  }
  return minutes < 48 * 60 ? `${Math.round(minutes / 60)} 小时` : `${Math.round(minutes / 60 / 24)} 天`
}

// 什么时候重置：一天以内写还有多久，再远写哪天几点
export function formatReset(resetsAt: number, now = Date.now()) {
  const left = resetsAt * 1000 - now
  if (left <= 0) {
    return '已重置'
  }
  return left < 24 * hour ? `${formatSpan(left)}后重置` : `${weekday.format(new Date(resetsAt * 1000))} 重置`
}

// 过了重置时间，报告的用量就不作数了
export const current = (window: QuotaWindow | undefined, now = Date.now()) => (window && window.resetsAt * 1000 > now ? window.utilization : 0)

export function level(utilization: number, limited: boolean) {
  return limited || utilization >= 0.95 ? 'danger' : utilization >= 0.8 ? 'warning' : undefined
}

// 窗口从短到长；rank 是第几短，longest 是最长的那个，显示时按它们画圈、配色
export function windowsOf(limits: Limits) {
  return limits.windows.map((window, rank) => ({
    key: window.id,
    rank,
    longest: rank === limits.windows.length - 1,
    name: windowName(window),
    length: window.minutes * 60_000,
    window,
  }))
}

// 一个窗口现在的情况：used 用了多少；left 还有多久重置（过了重置时间的没有）；expected 匀速用的话这时该用到多少；
// pace 比匀速多用（正）或少用（负）了多少；runsOut 按到现在为止的速度还有多久用完（重置前用不完时没有）
export type WindowState = { used: number; left?: number; expected: number; pace: number; runsOut?: number }

export function windowState(window: QuotaWindow | undefined, length: number, now: number): WindowState {
  if (!window || window.resetsAt * 1000 <= now) {
    return { used: 0, expected: 0, pace: 0 }
  }
  const left = window.resetsAt * 1000 - now
  const used = Math.min(window.utilization, 1)
  const elapsed = Math.min(Math.max(length - left, 1), length)
  const expected = elapsed / length
  const rate = used / elapsed
  const runsOut = used >= 1 ? 0 : rate > 0 && (1 - used) / rate < left ? (1 - used) / rate : undefined
  return { used, left, expected, pace: used - expected, ...(runsOut !== undefined && { runsOut }) }
}

// 被限流时卡住的那个窗口：还没重置的窗口里用得最满的；看不出是哪个时没有
export function blockingWindow(limits: Limits, now: number) {
  if (!limits.limited) {
    return undefined
  }
  return windowsOf(limits)
    .filter(({ window }) => window.resetsAt * 1000 > now)
    .sort((a, b) => b.window.utilization - a.window.utilization)[0]
}

// 一眼要看的：最紧的那个窗口用了多少，以及按现在的速度会不会在重置前用完
export function summary(limits: Limits, now: number) {
  const states = windowsOf(limits).map((item) => ({ ...item, ...windowState(item.window, item.length, now) }))
  const used = Math.max(0, ...states.map((state) => state.used))
  const runsOut = Math.min(...states.flatMap((state) => (state.runsOut === undefined ? [] : [state.runsOut])))
  return { used, ...(Number.isFinite(runsOut) && { runsOut }), limited: limits.limited }
}

// 额度按分钟变化，现在的时间每分钟更新一次就够
export function useMinuteNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  return now
}
