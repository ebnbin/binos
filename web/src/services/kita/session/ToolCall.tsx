import { formatDuration } from '../../../ui/format.ts'
import { Activity } from './Activity.tsx'
import styles from './ToolCall.module.css'
import { ToolBody } from './ToolBody.tsx'
import { callDuration, callStatus, lineChanges, toolLabel } from './tools.ts'
import type { CallState } from './tools.ts'

// 收起时显示的输出行数
const previewLines = 2
// 旧记录里 Claude Code 在命令输出后面附加的说明，不是命令本身的输出；新记录在读输出时就去掉了
const harnessNote = /^Shell cwd was reset to /

// 文件路径太长时只留后面几段
function shorten(text: string) {
  if (!text.startsWith('/') || text.length <= 48) {
    return text
  }
  const parts = text.split('/')
  return `…/${parts.slice(-3).join('/')}`
}

// 命令的输出、以及出错的工具的报错，收起时显示最后几行
function preview({ call, result }: CallState): string | undefined {
  if (!result?.output || (call.tool.kind !== 'command' && result.status !== 'error')) {
    return undefined
  }
  const lines = result.output.split('\n').filter((line) => line.trim() && !harnessNote.test(line))
  return lines.slice(-previewLines).join('\n') || undefined
}

export function ToolCall({ thread, state, now }: { thread: string; state: CallState; now: number }) {
  const { call, seq, result } = state
  const duration = callDuration(state, now)
  const changes = lineChanges(call)
  const label = toolLabel(call)
  return (
    <Activity
      icon={label.icon}
      label={label.verb}
      detail={label.detail ? shorten(label.detail) : ''}
      meta={
        <>
          {changes && changes.added > 0 && <span className={styles.added}>+{changes.added}</span>}
          {changes && changes.removed > 0 && <span className={styles.removed}>−{changes.removed}</span>}
          {call.background && <span>后台</span>}
          {duration !== undefined && <span>{formatDuration(duration)}</span>}
        </>
      }
      preview={preview(state)}
      status={callStatus(state)}
      body={() => <ToolBody thread={thread} seq={seq} call={call} result={result} />}
    />
  )
}
