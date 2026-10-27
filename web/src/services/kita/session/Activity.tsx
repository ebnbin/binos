import type { Icon } from '@phosphor-icons/react'
import { CaretRightIcon } from '@phosphor-icons/react'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Spinner } from '../../../ui/Spinner.tsx'
import styles from './Activity.module.css'

export type ActivityStatus = 'running' | 'done' | 'error' | 'stopped'

// 回答过程里的一步（思考、工具调用、子 agent）：图标（进行中是活动指示器）、动作、细节和右边的耗时等，点开像系统的展开行。
// preview 是收起时显示在下面的几行（比如命令输出的最后几行）。body 展开时才渲染：一个会话里有上百步，不展开的不用渲染
export function Activity({
  icon: Icon,
  label,
  detail,
  meta,
  preview,
  status = 'done',
  quiet = false,
  defaultOpen = false,
  body,
}: {
  icon?: Icon
  label: ReactNode
  detail?: ReactNode
  meta?: ReactNode
  preview?: string
  status?: ActivityStatus
  // 次要的一步（思考）：动作也用淡色
  quiet?: boolean
  defaultOpen?: boolean
  body?: () => ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={styles.activity} data-status={status} data-quiet={quiet || undefined} data-open={open || undefined}>
      <button type="button" className={styles.row} onClick={() => setOpen(!open)} disabled={!body} aria-expanded={body ? open : undefined}>
        <span className={styles.icon} aria-hidden={status !== 'running' || undefined}>
          {status === 'running' ? <Spinner /> : Icon ? <Icon /> : <span className={styles.dot} />}
        </span>
        <span className={styles.label}>{label}</span>
        {detail && <span className={styles.detail}>{detail}</span>}
        {meta && <span className={styles.meta}>{meta}</span>}
        {body && <CaretRightIcon className={styles.chevron} aria-hidden weight="bold" />}
      </button>
      {!open && preview && <pre className={styles.preview}>{preview}</pre>}
      {open && body && <div className={styles.body}>{body()}</div>}
    </div>
  )
}
