import type { Limits } from '@binos/protocol/services/kita'
import { blockingWindow, formatReset, formatSpan, windowsOf, windowState } from './quota.ts'
import styles from './Quota.module.css'

// 一个 agent 的订阅额度详情：每个窗口用了多少、多久重置，进度条上的竖线是匀速用到现在该到的位置，
// 下面一行是比匀速多用还是省、按现在的速度能不能撑到重置；被限流时先说卡在哪个窗口、什么时候恢复
export function QuotaWindows({ limits, now }: { limits: Limits; now: number }) {
  const blocking = blockingWindow(limits, now)
  return (
    <div className={styles.windows}>
      {limits.limited && (
        <p className={styles.limited}>
          {blocking
            ? `已被限流：${blocking.name}额度用满了，${formatReset(blocking.window.resetsAt, now).replace('重置', '恢复')}`
            : '已被限流'}
        </p>
      )}
      {windowsOf(limits).map(({ key, longest, name, window, length }) => {
        const { used, left, expected, pace, runsOut } = windowState(window, length, now)
        return (
          <div key={key} className={styles.window} data-longest={longest || undefined}>
            <div className={styles.windowLine}>
              <span className={styles.windowName}>
                <span className={styles.swatch} />
                {name}
              </span>
              <span>{Math.round(used * 100)}%</span>
              <span className={styles.muted}>{formatReset(window.resetsAt, now)}</span>
            </div>
            <div className={styles.bar} data-full={used >= 0.95 || undefined}>
              <span style={{ width: `${used * 100}%` }} />
              {left !== undefined && <i style={{ left: `${expected * 100}%` }} title="匀速用到现在该到的位置" />}
            </div>
            {left !== undefined && (
              <div className={styles.windowLine}>
                <span className={styles.muted}>{pace > 0.005 ? `比匀速多用 ${Math.round(pace * 100)}%` : `比匀速省 ${Math.round(-pace * 100)}%`}</span>
                <span className={runsOut === undefined ? styles.muted : styles.danger}>
                  {runsOut === undefined ? '够用到重置' : runsOut === 0 ? '已经用完' : `按现在的速度 ${formatSpan(runsOut)}后用完`}
                </span>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
