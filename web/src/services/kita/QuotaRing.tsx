import type { Limits } from '../../contract.ts'
import { windowsOf, windowState } from './quota.ts'
import styles from './Quota.module.css'

// 同心圆环，每个窗口一圈：越长的窗口在越外圈，弧长是用了多少，快满了变红
export function QuotaRing({ limits, now, size = 16 }: { limits: Limits; now: number; size?: number }) {
  const windows = windowsOf(limits)
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={styles.ring} aria-hidden>
      {windows.map(({ key, rank, longest, window, length }) => {
        const { used } = windowState(window, length, now)
        // 最里圈半径 5.5，最外圈 9.75
        const radius = windows.length > 1 ? 5.5 + (4.25 * rank) / (windows.length - 1) : 9.75
        const circumference = 2 * Math.PI * radius
        return (
          <g key={key} data-longest={longest || undefined} data-full={used >= 0.95 || undefined}>
            <circle cx="12" cy="12" r={radius} fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2.5" />
            <circle
              cx="12"
              cy="12"
              r={radius}
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - used)}
            />
          </g>
        )
      })}
    </svg>
  )
}
