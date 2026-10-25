import type { TaskProgress } from '@binos/server/services/kita/types'
import { Bot, ScrollText } from 'lucide-react'
import type { ReactNode } from 'react'
import { formatDuration, formatTokens } from '../../../ui/format.ts'
import { Activity } from './Activity.tsx'
import { Markdown } from './Markdown.tsx'
import styles from './SubagentCall.module.css'
import { callDuration, callStatus } from './tools.ts'
import { useFullCall } from './useFullCall.ts'
import type { CallState } from './tools.ts'

// 子 agent：一行是任务描述，运行中带上正在做的一步；展开是任务说明和它自己的过程（timeline）。
// 过程里已经有它最后的回复；没有过程的记录时（这个格式之前的会话）显示它交回的结果
export function SubagentCall({
  thread,
  state,
  progress,
  now,
  timeline,
}: {
  thread: string
  state: CallState
  progress: TaskProgress | undefined
  now: number
  timeline: ReactNode | undefined
}) {
  const { call, result } = state
  const tool = call.tool.kind === 'subagent' ? call.tool : { description: '', prompt: undefined, type: undefined }
  const { description, prompt, type } = tool
  const status = callStatus(state)
  const duration = callDuration(state, now)
  const running = status === 'running' && progress
  const meta = [
    call.background && '后台',
    running && progress.toolUses !== undefined && `${progress.toolUses} 次工具`,
    running && progress.tokens !== undefined && `${formatTokens(progress.tokens)} token`,
    duration !== undefined && formatDuration(duration),
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <Activity
      icon={Bot}
      label={type ? `子 agent（${type}）` : '子 agent'}
      detail={running && progress.activity ? `${description} · ${progress.activity}` : description}
      meta={meta}
      status={status}
      body={() => (
        <>
          {prompt && <Activity icon={ScrollText} label="任务说明" body={() => <pre className={styles.prompt}>{prompt}</pre>} />}
          {timeline}
          {!timeline && result?.output && <SubagentResult thread={thread} state={state} />}
        </>
      )}
    />
  )
}

// 没有过程的记录时交回的结果，发给页面时省略过就读完整的
function SubagentResult({ thread, state }: { thread: string; state: CallState }) {
  const { result } = useFullCall(thread, state.index, state.call, state.result)
  return result?.output ? <Markdown thread={thread} text={result.output} /> : null
}
