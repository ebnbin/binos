import { diffLines } from 'diff'
import { drivers } from './drivers/index.js'
import { browserOperation } from './drivers/tools.js'
import { pageEvent } from './journal.js'
import type { Event, PageEvent } from './journal.js'
import type { AgentId, Entry, FileChange, LineCount, ToolDetail } from './types.js'

// 客户端看到的事件：在记下的条目上补上由它算得出的语义（改了多少行、结构化的工具结果、模型的显示名……）。
// 记下的事件不会变，算过的记住，长会话每次读取都重算太慢
const projected = new WeakMap<Event, PageEvent>()

// journal 是 session 的全部事件，from、to 是要的那一段的位置
export function pageEvents(agent: AgentId, journal: readonly Event[], from = 0, to = journal.length): PageEvent[] {
  return journal.slice(from, to).map((event, i) => {
    let page = projected.get(event)
    if (!page) {
      page = { ...pageEvent(event), data: semantics(agent, journal, from + i) }
      projected.set(event, page)
    }
    return page
  })
}

function semantics(agent: AgentId, journal: readonly Event[], index: number): Entry {
  const { data, itemId } = journal[index]
  const driver = drivers[agent]
  switch (data.type) {
    case 'tool_call':
      return { ...data, tool: describe(data.tool, data.input) }
    case 'tool_result': {
      const call = callBefore(journal, index, itemId)
      const result = call && driver.result?.(call.tool, data)
      return result ? { ...data, ...result } : data
    }
    case 'turn_end': {
      const modelName = data.model && driver.modelName?.(data.model)
      return modelName ? { ...data, modelName } : data
    }
    default:
      return data
  }
}

// 调用总在结果之前，一般就在前面不远
function callBefore(journal: readonly Event[], index: number, itemId: string | null) {
  for (let i = index - 1; i >= 0; i--) {
    const { data } = journal[i]
    if (journal[i].itemId === itemId && data.type === 'tool_call') return data
  }
}

// 原始参数里的第一个文字参数
const firstText = (input: unknown) => Object.values((input ?? {}) as Record<string, unknown>).find((value) => typeof value === 'string') as string | undefined

function describe(tool: ToolDetail, input: unknown): ToolDetail {
  switch (tool.kind) {
    case 'edit':
      return tool.change ? { ...tool, lines: lineCount(tool.change) } : tool
    case 'browser':
      return { ...tool, operation: browserOperation(tool.action) }
    case 'mcp':
    case 'other': {
      const target = firstText(input)
      return target ? { ...tool, target } : tool
    }
    default:
      return tool
  }
}

function lineCount(change: FileChange): LineCount {
  switch (change.type) {
    case 'write':
      return { added: change.content.replace(/\n$/, '').split('\n').length, removed: 0 }
    case 'replace': {
      const count = { added: 0, removed: 0 }
      for (const part of diffLines(change.before, change.after)) {
        if (part.added) count.added += part.count ?? 0
        else if (part.removed) count.removed += part.count ?? 0
      }
      return count
    }
    // 新建和删除时 diff 是整个文件的内容，修改时是统一格式的 diff
    case 'diff': {
      const lines = change.diff.replace(/\n$/, '').split('\n')
      if (change.op !== 'update') {
        const count = change.diff ? lines.length : 0
        return change.op === 'add' ? { added: count, removed: 0 } : { added: 0, removed: count }
      }
      const body = lines.filter((line) => !line.startsWith('+++') && !line.startsWith('---'))
      return { added: body.filter((line) => line.startsWith('+')).length, removed: body.filter((line) => line.startsWith('-')).length }
    }
  }
}
