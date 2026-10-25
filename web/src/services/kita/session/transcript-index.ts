import type { PageEvent } from '@binos/server/services/kita/journal'
import type { ToolResult } from './tools.ts'

// 一轮：turnId 相同的连续事件，第一条 session 条目自成一组（id 为空串）。
// 工具调用和结果按 itemId 对应，子 agent 的条目按 parentId 归到它所属的调用下
export type Turn = {
  id: string
  first: PageEvent
  size: number
  main: PageEvent[]
  results: Map<string, ToolResult>
  children: Map<string, PageEvent[]>
}

function indexTurn(events: PageEvent[]): Turn {
  const results = new Map<string, ToolResult>()
  const children = new Map<string, PageEvent[]>()
  const main: PageEvent[] = []
  for (const event of events) {
    if (event.data.type === 'tool_result' && event.itemId) {
      results.set(event.itemId, event.data)
    }
    if (event.parentId) {
      children.set(event.parentId, [...(children.get(event.parentId) ?? []), event])
    } else {
      main.push(event)
    }
  }
  return { id: events[0].turnId ?? '', first: events[0], size: events.length, main, results, children }
}

// 事件只会在两头增加：和 previous 里同一段事件的轮沿用原来的对象，页面上这些轮可以跳过重新渲染
export function splitTurns(events: PageEvent[], previous: Turn[] = []): Turn[] {
  const reusable = new Map(previous.map((turn) => [turn.id, turn]))
  const turns: Turn[] = []
  for (let start = 0; start < events.length; ) {
    let end = start + 1
    while (end < events.length && events[end].turnId === events[start].turnId) end++
    const old = reusable.get(events[start].turnId ?? '')
    turns.push(old?.first === events[start] && old.size === end - start ? old : indexTurn(events.slice(start, end)))
    start = end
  }
  return turns
}
