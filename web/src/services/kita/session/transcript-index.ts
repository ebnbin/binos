import type { Entry } from '@binos/server/services/kita/types'
import type { ToolCall, ToolResult } from './tools.ts'

export type IndexedEntry = { item: Entry; index: number }

// 一轮：从 mode 为 start 的 input 到下一个之前，第一轮之前的条目单独成一组。
// vendor 的调用 id 只在当前轮内匹配；渲染时用调用对象关联结果和子条目
export type Turn = {
  first: Entry
  start: number
  size: number
  main: IndexedEntry[]
  results: Map<ToolCall, ToolResult>
  children: Map<ToolCall, IndexedEntry[]>
}

function indexTurn(items: Entry[], offset: number, start: number, end: number): Turn {
  const entries = items.slice(start, end).map((item, i) => ({ item, index: offset + start + i }))
  const calls = new Map(entries.flatMap(({ item }) => item.type === 'tool_call' ? [[item.id, item] as const] : []))
  const results = new Map<ToolCall, ToolResult>()
  const children = new Map<ToolCall, IndexedEntry[]>()
  const main: IndexedEntry[] = []
  for (const entry of entries) {
    const { item } = entry
    if (item.type === 'tool_result') {
      const call = calls.get(item.callId)
      if (call) results.set(call, item)
    }
    const parent = 'parent' in item && item.parent ? calls.get(item.parent) : undefined
    if (parent) {
      const siblings = children.get(parent) ?? []
      siblings.push(entry)
      children.set(parent, siblings)
    } else {
      main.push(entry)
    }
  }
  return { first: items[start], start: offset + start, size: end - start, main, results, children }
}

// items 是从 offset 开始的条目，轮的 start 和条目的 index 都是在整个 thread 里的位置。
// 条目只会在两头增加：和 previous 里同一段条目的轮沿用原来的对象，页面上这些轮可以跳过重新渲染
export function splitTurns(items: Entry[], previous: Turn[] = [], offset = 0): Turn[] {
  const reusable = new Map(previous.map((turn) => [turn.start, turn]))
  const starts = items.flatMap((item, index) => (index === 0 || (item.type === 'input' && item.mode === 'start') ? [index] : []))
  return starts.map((start, i) => {
    const end = starts[i + 1] ?? items.length
    const old = reusable.get(offset + start)
    return old?.first === items[start] && old.size === end - start ? old : indexTurn(items, offset, start, end)
  })
}
