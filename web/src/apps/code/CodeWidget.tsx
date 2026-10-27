import { NotePencilIcon } from '@phosphor-icons/react'
import type { WidgetContext } from '../types.ts'
import styles from './CodeWidget.module.css'
import { formatTime } from '../../ui/time.ts'
import { useSessions } from './useSessions.ts'

// 最近的对话，点一条直接打开
export function CodeWidget({ size, open }: WidgetContext) {
  const { sessions } = useSessions()
  const running = sessions?.filter((session) => session.running).length ?? 0
  const shown = sessions?.slice(0, size === '4x4' ? 8 : 3) ?? []

  return (
    <div className={styles.widget}>
      <header className={styles.header}>
        <span className={styles.name}>Code</span>
        {running > 0 && <span className={styles.running}>{running} 个进行中</span>}
        <button
          type="button"
          className={styles.new}
          aria-label="新对话"
          title="新对话"
          onClick={(event) => {
            event.stopPropagation()
            open('/new')
          }}
        >
          <NotePencilIcon size={16} />
        </button>
      </header>
      {size === '2x2' ? (
        <div className={styles.summary}>
          <span className={styles.count}>{sessions?.length ?? '…'}</span>
          <span className={styles.muted}>个对话</span>
        </div>
      ) : sessions?.length === 0 ? (
        <p className={styles.empty}>还没有对话</p>
      ) : (
        <ul className={styles.list}>
          {shown.map((session) => (
            <li key={session.id}>
              <button
                type="button"
                className={styles.row}
                onClick={(event) => {
                  event.stopPropagation()
                  open(`/${session.id}`)
                }}
              >
                <span className={styles.dot} data-running={session.running} />
                <span className={styles.title}>{session.title || '新对话'}</span>
                <span className={styles.time}>{session.updatedAt ? formatTime(new Date(session.updatedAt)) : ''}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
