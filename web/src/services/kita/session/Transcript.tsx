import type { PageEvent } from '@binos/server/services/kita/journal'
import type { AgentId, Attachment, Entry, Live, Status } from '@binos/server/services/kita/types'
import { ChevronRight } from 'lucide-react'
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { Alert } from '../../../ui/Alert.tsx'
import { CopyButton } from '../../../ui/CopyButton.tsx'
import { formatDuration, formatTokens, useNow } from '../../../ui/format.ts'
import { formatClock, formatDivider, formatFull, sameDay } from '../../../ui/time.ts'
import { modelName } from '../views.ts'
import { AttachmentList } from './Attachments.tsx'
import { Markdown } from './Markdown.tsx'
import { SubagentCall } from './SubagentCall.tsx'
import { Thinking } from './Thinking.tsx'
import { ToolCall } from './ToolCall.tsx'
import { callStatus, fileChanges, isFileEdit, toolLabel } from './tools.ts'
import type { CallState, ToolCategory, ToolResult } from './tools.ts'
import { splitTurns } from './transcript-index.ts'
import type { Turn } from './transcript-index.ts'
import styles from './Transcript.module.css'
import { TurnChanges } from './TurnChanges.tsx'

type TurnEndItem = Extract<Entry, { type: 'turn_end' }>
type CompactItem = Extract<Entry, { type: 'compact' }>

// 显示出来的一块
type Block =
  | { kind: 'input'; key: string; text: string; time: string }
  | { kind: 'time'; key: string; time: string }
  // 一轮从这里开始，主对话按轮分节
  | { kind: 'turn'; key: string }
  | { kind: 'attachments'; key: string; attachments: Attachment[] }
  | { kind: 'text'; key: string; text: string; files?: Record<string, string> }
  | { kind: 'steps'; key: string; steps: Step[] }
  | { kind: 'compact'; key: string; item: CompactItem }
  | { kind: 'interrupted'; key: string }
  // reply：这一轮回复的全部文字，用于复制；edits：这一轮（包括子 agent）改文件的调用
  | { kind: 'turn_end'; key: string; item: TurnEndItem; reply: string; edits: CallState[] }

// 回答过程中的一步：思考、工具调用、子 agent。两段文字之间连续的几步合成一组
type Step =
  | { kind: 'thinking'; key: string; time: string; text: string; durationMs?: number }
  | { kind: 'tool'; key: string; time: string; state: CallState }
  | { kind: 'subagent'; key: string; time: string; state: CallState }

// 工具结果和子 agent 的条目按所属调用的 itemId 关联
type Context = {
  thread: string
  agent: AgentId | undefined
  results: Map<string, ToolResult>
  children: Map<string, PageEvent[]>
  live: Live | null
  now: number
}

// 一轮开始时离上一条超过这么久，先显示一条时间
const dividerGap = 30 * 60 * 1000

// lastTime：上一条的时间，一轮开始时离它太久或者跨了天，就先显示一条时间
function buildBlocks(entries: PageEvent[], context: Context, lastTime?: string): Block[] {
  const blocks: Block[] = []
  const addStep = (step: Step) => {
    const last = blocks.at(-1)
    if (last?.kind === 'steps') {
      last.steps.push(step)
    } else {
      blocks.push({ kind: 'steps', key: step.key, steps: [step] })
    }
  }
  // 这一轮到目前为止回复的文字和改文件的调用
  let replies: string[] = []
  let edits: CallState[] = []
  let current = lastTime === undefined ? undefined : new Date(lastTime)
  for (const { data: item, seq, itemId } of entries) {
    const key = String(seq)
    const previous = current
    current = new Date(item.time)
    switch (item.type) {
      case 'input':
        if (item.mode === 'start') {
          replies = []
          edits = []
          blocks.push({ kind: 'turn', key: `${key}-turn` })
          const time = new Date(item.time)
          if (!previous || time.getTime() - previous.getTime() > dividerGap || !sameDay(time, previous)) {
            blocks.push({ kind: 'time', key: `${key}-time`, time: item.time })
          }
        }
        if (item.mode === 'interrupt') {
          blocks.push({ kind: 'interrupted', key: `${key}-interrupted` })
        }
        if (item.attachments?.length) {
          blocks.push({ kind: 'attachments', key: `${key}-attachments`, attachments: item.attachments })
        }
        if (item.text.trim()) {
          blocks.push({ kind: 'input', key, text: item.text, time: item.time })
        }
        break
      case 'thinking':
        addStep({ kind: 'thinking', key, time: item.time, text: item.text, durationMs: item.durationMs })
        break
      case 'text':
        if (item.text.trim()) {
          replies.push(item.text)
          blocks.push({ kind: 'text', key, text: item.text, files: item.files })
        }
        break
      case 'tool_call': {
        const state = { call: item, seq, itemId: itemId ?? '', result: context.results.get(itemId ?? ''), live: context.live !== null }
        edits.push(...editCalls(state, context))
        addStep({ kind: item.tool.kind === 'subagent' ? 'subagent' : 'tool', key, time: item.time, state })
        break
      }
      case 'compact':
        blocks.push({ kind: 'compact', key, item })
        break
      case 'turn_end':
        blocks.push({ kind: 'turn_end', key, item, reply: replies.join('\n\n'), edits })
        break
    }
  }
  return blocks
}

// 这次调用改了文件就是它自己；是子 agent 时，是子 agent 里改文件的调用
function editCalls(state: CallState, context: Context): CallState[] {
  if (isFileEdit(state.call)) {
    return [state]
  }
  return (context.children.get(state.itemId) ?? []).flatMap(({ data, seq, itemId }) =>
    data.type === 'tool_call' ? editCalls({ call: data, seq, itemId: itemId ?? '', result: context.results.get(itemId ?? ''), live: state.live }, context) : [],
  )
}

// 主对话的一轮。没变的轮跳过重新渲染：只有最后一轮带 live、now 和 tail（回答进行中的临时内容），推送和计时只让它跟着动。
// previousTime：上一轮最后一条的时间
const TurnSection = memo(function TurnSection({
  thread,
  agent,
  turn,
  previousTime,
  live,
  now,
  tail,
}: {
  thread: string
  agent: AgentId | undefined
  turn: Turn
  previousTime: string | undefined
  live: Live | null
  now: number
  tail?: ReactNode
}) {
  const context: Context = { thread, agent, results: turn.results, children: turn.children, live, now }
  const blocks = buildBlocks(turn.main, context, previousTime)
  if (!blocks.length && !tail) {
    return null
  }
  return (
    <section className={styles.turn} data-turn={turn.id}>
      {renderBlocks(blocks, context, tail === undefined ? undefined : blocks.at(-1))}
      {tail}
    </section>
  )
})

function Timeline({ entries, context }: { entries: PageEvent[]; context: Context }) {
  const blocks = buildBlocks(entries, context)
  return renderBlocks(blocks, context, blocks.at(-1))
}

// last：整个对话的最后一块，正在进行的那一组步骤展开
function renderBlocks(blocks: Block[], context: Context, last: Block | undefined) {
  const { thread } = context
  return blocks.map((block) => {
    switch (block.kind) {
      case 'turn':
        return null
      case 'input':
        return (
          <div key={block.key} data-thread-item={block.key} className={styles.user}>
            <div className={styles.userText}>{block.text}</div>
            <div className={styles.userMeta}>
              <time dateTime={block.time} title={formatFull(new Date(block.time))}>
                {formatClock(new Date(block.time))}
              </time>
              <CopyButton text={block.text} label="复制消息" />
            </div>
          </div>
        )
      case 'time':
        return (
          <div key={block.key} className={styles.time}>
            {formatDivider(new Date(block.time))}
          </div>
        )
      case 'attachments':
        return <AttachmentList key={block.key} thread={thread} attachments={block.attachments} />
      case 'text':
        return <div key={block.key} data-thread-item={block.key}><Markdown thread={thread} text={block.text} files={block.files} /></div>
      case 'steps':
        return <Steps key={block.key} steps={block.steps} context={context} last={block === last} />
      case 'interrupted':
        return (
          <div key={block.key} className={styles.divider}>
            已打断
          </div>
        )
      case 'compact':
        return (
          <div key={block.key} className={styles.divider}>
            {compactText(block.item)}
          </div>
        )
      case 'turn_end':
        return <TurnEnd key={block.key} thread={thread} agent={context.agent} item={block.item} reply={block.reply} edits={block.edits} />
    }
  })
}

function StepView({ step, context }: { step: Step; context: Context }) {
  const { thread } = context
  switch (step.kind) {
    case 'thinking':
      return <Thinking thread={thread} text={step.text} durationMs={step.durationMs} />
    case 'tool':
      return <ToolCall thread={thread} state={step.state} now={context.now} />
    case 'subagent': {
      const children = context.children.get(step.state.itemId)
      return (
        <SubagentCall
          thread={thread}
          state={step.state}
          progress={context.live?.tasks[step.state.call.id]}
          now={context.now}
          timeline={children && <Timeline entries={children} context={context} />}
        />
      )
    }
  }
}

const categoryText: Record<ToolCategory, (count: number) => string> = {
  command: (n) => `运行 ${n} 条命令`,
  read: (n) => `查看 ${n} 个文件`,
  edit: (n) => `修改 ${n} 个文件`,
  search: (n) => `搜索 ${n} 次`,
  web: (n) => `打开 ${n} 个网页`,
  browser: (n) => `操作浏览器 ${n} 次`,
  subagent: (n) => `启动 ${n} 个子 agent`,
  other: (n) => `调用 ${n} 次工具`,
}

// 一组步骤的摘要，比如「运行 3 条命令，查看 2 个文件」；修改的文件按路径去重
function summarize(steps: Step[]) {
  const counts = new Map<ToolCategory, Set<string>>()
  for (const step of steps) {
    if (step.kind === 'thinking') {
      continue
    }
    const { call } = step.state
    const { category } = toolLabel(call)
    const id = call.tool.kind === 'edit' ? call.tool.path : call.id
    counts.set(category, (counts.get(category) ?? new Set()).add(id))
  }
  const parts = (Object.keys(categoryText) as ToolCategory[]).flatMap((category) => {
    const count = counts.get(category)?.size
    return count ? [categoryText[category](count)] : []
  })
  return parts.length ? parts.join('，') : `思考 ${steps.length} 次`
}

// 连续的几步：最多只有一次工具调用时直接显示；多次时收成一行「已工作 …」，正在进行的那一组展开，答完了收起，点开看每一步
function Steps({ steps, context, last }: { steps: Step[]; context: Context; last: boolean }) {
  const [userOpen, setUserOpen] = useState<boolean>()
  const states = steps.flatMap((step) => (step.kind === 'thinking' ? [] : [step.state]))
  const list = steps.map((step) => <StepView key={step.key} step={step} context={context} />)
  if (states.length <= 1) {
    return list
  }
  const running = states.some((state) => callStatus(state) === 'running')
  const errors = states.filter((state) => callStatus(state) === 'error').length
  const first = steps[0]
  const start = Date.parse(first.time) - (first.kind === 'thinking' ? (first.durationMs ?? 0) : 0)
  const end = Math.max(
    ...steps.map((step) =>
      step.kind === 'thinking'
        ? Date.parse(step.time)
        : step.state.result
          ? Date.parse(step.state.result.time)
          : running
            ? context.now
            : Date.parse(step.time),
    ),
  )
  const open = userOpen ?? (context.live !== null && last)
  return (
    <div className={styles.worked} data-open={open || undefined}>
      <button type="button" className={styles.workedRow} onClick={() => setUserOpen(!open)} aria-expanded={open}>
        <span>
          {running ? '正在工作' : '已工作'} {formatDuration(Math.max(end - start, 0))} · {summarize(steps)}
          {errors > 0 && <span className={styles.errors}> · {errors} 个出错</span>}
        </span>
        <ChevronRight strokeWidth={2.25} className={styles.workedChevron} aria-hidden />
      </button>
      {open && <div className={styles.steps}>{list}</div>}
    </div>
  )
}

function compactText({ trigger, preTokens, postTokens }: CompactItem) {
  const sizes = preTokens !== undefined && postTokens !== undefined ? `（${formatTokens(preTokens)} → ${formatTokens(postTokens)} token）` : ''
  return `${trigger === 'manual' ? '手动' : '自动'}压缩了上下文${sizes}`
}

// 一轮的结尾：停止、出错，以及这一轮的统计
function TurnEnd({ thread, agent, item, reply, edits }: { thread: string; agent: AgentId | undefined; item: TurnEndItem; reply: string; edits: CallState[] }) {
  const files = fileChanges(edits)
  const { durationMs, outputTokens, context, model, outcome, error } = item
  const stats = [
    `用时 ${formatDuration(durationMs)}`,
    outputTokens !== undefined && `输出 ${formatTokens(outputTokens)} token`,
    context && `上下文 ${Math.round((context.tokens / context.window) * 100)}%`,
    model && (agent ? modelName(agent, model) : model),
  ].filter(Boolean)
  const changes = files.length > 0 && <TurnChanges thread={thread} files={files} />
  if (outcome === 'stopped') {
    return (
      <>
        {changes}
        <div className={styles.divider}>已停止 · {stats[0]}</div>
      </>
    )
  }
  return (
    <>
      {changes}
      {outcome === 'error' && <Alert>{error ?? 'agent 出错了'}</Alert>}
      <div className={styles.stats}>
        <span
          title={[`${formatFull(new Date(item.time))} 答完`, context && `上下文 ${context.tokens.toLocaleString()} / ${context.window.toLocaleString()} token`]
            .filter(Boolean)
            .join('\n')}
        >
          {[formatClock(new Date(item.time)), ...stats].join(' · ')}
        </span>
        {reply && <CopyButton text={reply} label="复制回复" />}
      </div>
    </>
  )
}

// runningTool：主对话里还没有结果的最后一次工具调用
function statusText(status: Status | null, live: Live, runningTool: string | undefined) {
  switch (status?.type) {
    case 'requesting':
      return '等待模型'
    case 'thinking':
      return '思考中'
    case 'tool':
      return `正在调用 ${status.name}`
    case 'compacting':
      return '正在压缩上下文'
    case 'waiting':
      return `已答完，等待 ${status.tasks} 个后台任务`
    case 'retrying':
      return `请求失败，第 ${status.attempt} 次重试`
    default:
      return live.text ? '正在回答' : runningTool ? `正在运行 ${runningTool}` : '正在处理'
  }
}

// 进行中的一轮的已用时间，只到秒
function formatElapsed(ms: number) {
  const seconds = Math.max(Math.floor(ms / 1000), 0)
  return seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`
}

// 补读更早的轮时，离顶部还有这么远就开始读
const olderMargin = 1500

// 一轮在滚动内容里的位置，用它的第一条（时间分隔线下面）定位，补读后分隔线的有无不影响
function turnTop(scroller: HTMLElement, turn: string) {
  const section = scroller.querySelector(`[data-turn="${turn}"]`)
  const target = section?.querySelector('[data-thread-item]') ?? section
  return target && target.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop
}

// thread 的内容：按轮分节，回答进行中的临时内容接在最后。events 是连续的一段，
// 第一条的 seq 大于 1 时滚到离顶部不远处由 loadOlder 补读更早的轮；scrollRef 是对话滚动的那一层
export function Transcript({
  thread,
  agent,
  events,
  live,
  scrollRef,
  loadOlder,
}: {
  thread: string
  agent: AgentId | undefined
  events: PageEvent[]
  live: Live | null
  scrollRef: RefObject<HTMLElement | null>
  loadOlder: () => void
}) {
  const now = useNow(live !== null)
  const [split] = useState(() => {
    let previous: Turn[] = []
    return (events: PageEvent[]) => (previous = splitTurns(events, previous))
  })
  const turns = useMemo(() => split(events), [split, events])
  const current = turns.at(-1)
  const runningTool = current?.main.findLast(({ data, itemId }) => data.type === 'tool_call' && !current.results.has(itemId ?? ''))?.data
  const firstSeq = events[0]?.seq ?? 1
  // 这一轮从 mode 为 start 的 input 开始
  const first = current?.first.data
  const turnStart = first?.type === 'input' && first.mode === 'start' ? first.time : undefined

  const sentinel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const root = scrollRef.current
    if (!root || !sentinel.current) {
      return
    }
    // loadOlder 随读到的位置变化，每读完一段重新观察：还在顶部附近就接着读
    const observer = new IntersectionObserver((entries) => entries.some((entry) => entry.isIntersecting) && loadOlder(), {
      root,
      rootMargin: `${olderMargin}px 0px 0px 0px`,
    })
    observer.observe(sentinel.current)
    return () => observer.disconnect()
  }, [scrollRef, loadOlder, firstSeq])

  // 前面补上更早的轮后，原来第一轮在内容里的位置往下移了，滚动跟着移同样的距离，正在看的内容不动
  const anchor = useRef<{ turn: string; top: number }>(undefined)
  const firstTurn = turns[0]?.id
  useLayoutEffect(() => {
    const scroller = scrollRef.current
    if (!scroller || firstTurn === undefined) {
      return
    }
    const previous = anchor.current
    const moved = previous && previous.turn !== firstTurn ? turnTop(scroller, previous.turn) : null
    if (previous && moved != null) {
      scroller.scrollTop += moved - previous.top
    }
    const top = turnTop(scroller, firstTurn)
    anchor.current = top == null ? undefined : { turn: firstTurn, top }
  }, [scrollRef, firstTurn])

  const tail = (
    <>
      {live?.thinking && <Thinking thread={thread} text={live.thinking} live />}
      {live?.text.trim() && <Markdown thread={thread} text={live.text} files={live.files} />}
      {live && (
        <div className={styles.status}>
          {statusText(live.status, live, runningTool?.type === 'tool_call' ? runningTool.name : undefined)}
          {turnStart && ` · ${formatElapsed(now - Date.parse(turnStart))}`}
        </div>
      )}
    </>
  )
  return (
    <>
      {firstSeq > 1 && (
        <div ref={sentinel} className={styles.older}>
          正在读取更早的消息
        </div>
      )}
      {turns.map((turn, index) => {
        const last = index === turns.length - 1
        return (
          <TurnSection
            key={turn.id}
            thread={thread}
            agent={agent}
            turn={turn}
            previousTime={turns[index - 1]?.main.at(-1)?.data.time}
            live={last ? live : null}
            now={last ? now : 0}
            tail={last ? tail : undefined}
          />
        )
      })}
    </>
  )
}
