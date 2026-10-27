import { BrainIcon } from '@phosphor-icons/react'
import { formatDuration } from '../../../ui/format.ts'
import { Activity } from './Activity.tsx'
import styles from './Thinking.module.css'
import { Markdown } from './Markdown.tsx'

// 思考的摘要：正在想的时候展开，想完了是一行
export function Thinking({ thread, text, durationMs, live }: { thread: string; text: string; durationMs?: number; live?: boolean }) {
  return (
    <Activity
      icon={BrainIcon}
      status={live ? 'running' : 'done'}
      label={live ? '正在思考' : durationMs !== undefined ? `思考了 ${formatDuration(durationMs)}` : '思考'}
      quiet
      defaultOpen={live}
      body={() => (
        <div className={styles.text}>
          <Markdown thread={thread} text={text} />
        </div>
      )}
    />
  )
}
