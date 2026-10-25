import { randomUUID } from 'node:crypto'
import type { Entry } from './types.js'

export type SessionMetadata = Extract<Entry, { type: 'session' }> & { format: 1; id: string }

export type Event = {
  seq: number
  id: string
  turnId: string | null
  itemId: string | null
  type: 'session.created' | 'turn.started' | 'turn.finished' | 'vendor.bound' | 'item.started' | 'item.completed' | 'item.added'
  data: Entry
}

export type Turn = { id: string; startedAt: string; finishedAt?: string; outcome?: 'stopped' | 'error'; error?: string }
export type Item = { id: string; turnId: string | null; kind: 'input' | 'text' | 'thinking' | 'tool' | 'compact'; entries: Entry[] }

// 原始协议的一行可能生成多条记录；它们作为同一批提交，重启时才能按 offset 安全地去重。
export type EventBatch = { events: Event[] }

export function encodeEntries(entries: Entry[], previous: Event | undefined): Event[] {
  let turnId = previous?.turnId ?? null
  let seq = (previous?.seq ?? 0) + 1
  return entries.map((data) => {
    if (data.type === 'input' && data.mode === 'start') turnId = randomUUID()
    const type = data.type === 'session' ? 'session.created'
      : data.type === 'input' && data.mode === 'start' ? 'turn.started'
      : data.type === 'turn_end' ? 'turn.finished'
      : data.type === 'agent_session' ? 'vendor.bound'
      : data.type === 'tool_call' ? 'item.started'
      : data.type === 'tool_result' ? 'item.completed'
      : 'item.added'
    const itemId = data.type === 'session' || data.type === 'turn_end' || data.type === 'agent_session' ? null
      : data.type === 'tool_call' ? `${turnId}:${data.id}`
      : data.type === 'tool_result' ? `${turnId}:${data.callId}`
      : randomUUID()
    return { seq: seq++, id: randomUUID(), turnId, itemId, type, data }
  })
}

export function projectTurns(events: Event[]): Turn[] {
  const turns = new Map<string, Turn>()
  for (const event of events) {
    if (!event.turnId) continue
    if (event.type === 'turn.started') turns.set(event.turnId, { id: event.turnId, startedAt: event.data.time })
    if (event.data.type === 'turn_end') {
      const turn = turns.get(event.turnId)
      if (turn) Object.assign(turn, { finishedAt: event.data.time, outcome: event.data.outcome, error: event.data.error })
    }
  }
  return [...turns.values()]
}

export function projectItems(events: Event[]): Item[] {
  const items = new Map<string, Item>()
  for (const { itemId, turnId, data } of events) {
    if (!itemId || data.type === 'session' || data.type === 'turn_end' || data.type === 'agent_session') continue
    const kind = data.type === 'tool_call' || data.type === 'tool_result' ? 'tool' : data.type
    const item = items.get(itemId) ?? { id: itemId, turnId, kind, entries: [] }
    item.entries.push(data)
    items.set(itemId, item)
  }
  return [...items.values()]
}

// 发给页面的命令和输出最多这么长：收起时只显示命令的开头、输出的最后几行，展开时再读完整的
const pageTextLimit = 512

// 从末尾往前留 limit 个字符，能在换行处切开就不留半行
function tail(text: string, limit: number) {
  const kept = text.slice(-limit)
  const newline = kept.indexOf('\n')
  return newline >= 0 && newline < kept.length - 1 ? kept.slice(newline + 1) : kept
}

// 页面只用到事件的序号和条目
export type PageEvent = Pick<Event, 'seq' | 'data'>

// 发给页面的事件：过长的命令和工具输出省略掉，长会话里它们占了绝大部分的体积
export function clipEvent({ seq, data }: PageEvent): PageEvent {
  if (data.type === 'tool_call' && data.tool.kind === 'command' && data.tool.command.length > pageTextLimit) {
    return { seq, data: { ...data, tool: { ...data.tool, command: data.tool.command.slice(0, pageTextLimit) }, clipped: true } }
  }
  if (data.type === 'tool_result' && data.output && data.output.length > pageTextLimit) {
    return { seq, data: { ...data, output: tail(data.output, pageTextLimit), clipped: true } }
  }
  return { seq, data }
}
