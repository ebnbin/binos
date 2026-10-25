import type { Entry } from '@binos/server/services/kita/types'
import { diffLines } from 'diff'
import { AppWindow, Bot, FilePen, FilePlus, FileText, Globe, Image, ListTodo, PackageSearch, Search, Sparkles, SquareTerminal, Wrench } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export type ToolCall = Extract<Entry, { type: 'tool_call' }>
export type ToolResult = Extract<Entry, { type: 'tool_result' }>
// index：调用在整个 thread 里的位置；live：这一轮还在回答，没有结果的调用还在运行
export type CallState = { call: ToolCall; index: number; result: ToolResult | undefined; live: boolean }

export type CallStatus = 'running' | 'done' | 'error' | 'stopped'

export function callStatus({ result, live }: CallState): CallStatus {
  return result ? result.status : live ? 'running' : 'stopped'
}

// 结束了的是调用到结果的时间，还在运行的是到现在的时间
export function callDuration({ call, result, live }: CallState, now: number): number | undefined {
  if (result) {
    return Date.parse(result.time) - Date.parse(call.time)
  }
  return live ? Math.max(now - Date.parse(call.time), 0) : undefined
}

// 分组摘要里按这些类别计数
export type ToolCategory = 'command' | 'read' | 'edit' | 'search' | 'web' | 'browser' | 'subagent' | 'other'

// 一次调用显示成：图标、动作、对象（命令、路径、搜索词……）
type ToolLabel = { icon: LucideIcon; verb: string; category: ToolCategory; detail?: string }

// 浏览器的工具，没列出的直接用工具名
const browserVerbs: Record<string, string> = {
  navigate: '浏览器打开',
  computer: '操作浏览器',
  browser_batch: '操作浏览器',
  javascript_tool: '在浏览器里执行脚本',
  read_page: '读取页面',
  get_page_text: '读取页面',
  find: '在页面里查找',
  form_input: '填写表单',
  read_console_messages: '查看控制台',
  read_network_requests: '查看网络请求',
  tabs_context_mcp: '查看标签页',
  tabs_create_mcp: '新建标签页',
  tabs_close_mcp: '关闭标签页',
}

// 原始参数里的第一个字符串
const firstText = (input: unknown) => Object.values((input ?? {}) as Record<string, unknown>).find((value) => typeof value === 'string') as string | undefined

export function toolLabel({ name, tool, input }: ToolCall): ToolLabel {
  switch (tool.kind) {
    case 'command':
      return { icon: SquareTerminal, verb: '运行', category: 'command', detail: tool.command }
    case 'read':
      return { icon: FileText, verb: '查看', category: 'read', detail: tool.path }
    case 'edit':
      return tool.change?.type === 'write'
        ? { icon: FilePlus, verb: '写入', category: 'edit', detail: tool.path }
        : { icon: FilePen, verb: '修改', category: 'edit', detail: tool.path }
    case 'search':
      return { icon: Search, verb: tool.target === 'files' ? '查找文件' : '搜索', category: 'search', detail: tool.pattern }
    case 'web_search':
      return { icon: Globe, verb: '搜索网页', category: 'search', detail: tool.query }
    case 'web_fetch':
      return { icon: Globe, verb: '打开网页', category: 'web', detail: tool.url }
    case 'image_view':
      return { icon: Image, verb: '查看图片', category: 'read', detail: tool.path }
    case 'browser':
      return { icon: AppWindow, verb: browserVerbs[tool.action] ?? `浏览器 ${tool.action}`, category: 'browser', detail: tool.target }
    case 'mcp':
      return { icon: Wrench, verb: `${tool.server} ${tool.tool}`, category: 'other', detail: firstText(input) }
    case 'subagent':
      return { icon: Bot, verb: '子 agent', category: 'subagent', detail: tool.description }
    case 'tool_search':
      return { icon: PackageSearch, verb: '加载工具', category: 'other', detail: tool.query }
    case 'skill':
      return { icon: Sparkles, verb: '使用技能', category: 'other', detail: tool.name }
    case 'todo':
      return { icon: ListTodo, verb: '更新待办', category: 'other' }
    case 'other':
      return { icon: Wrench, verb: name.replace(/^mcp__/, '').replaceAll('__', ' '), category: 'other', detail: firstText(input) }
  }
}

type LineChanges = { added: number; removed: number }

// 条目不会变，算过的记下来：每次渲染都对整段内容做 diff 太慢
const lineChangesCache = new WeakMap<ToolCall, LineChanges | undefined>()

// 改文件增删了多少行
export function lineChanges(call: ToolCall): LineChanges | undefined {
  if (!lineChangesCache.has(call)) {
    lineChangesCache.set(call, countLines(call))
  }
  return lineChangesCache.get(call)
}

function countLines({ tool }: ToolCall): LineChanges | undefined {
  if (tool.kind !== 'edit' || !tool.change) {
    return undefined
  }
  const { change } = tool
  switch (change.type) {
    case 'write':
      return { added: change.content.replace(/\n$/, '').split('\n').length, removed: 0 }
    case 'replace': {
      let added = 0
      let removed = 0
      for (const part of diffLines(change.before, change.after)) {
        if (part.added) {
          added += part.count ?? 0
        } else if (part.removed) {
          removed += part.count ?? 0
        }
      }
      return { added, removed }
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

// 一轮里改过的一个文件：增删的行数合计，以及改它的每一次调用。op 是新建或删除了它
export type FileChange = { path: string; added: number; removed: number; op?: 'add' | 'delete'; calls: CallState[] }

export const isFileEdit = (call: ToolCall) => call.tool.kind === 'edit'

// 成功的修改按文件合并，顺序是第一次改它的顺序
export function fileChanges(states: CallState[]): FileChange[] {
  const files = new Map<string, FileChange>()
  for (const state of states) {
    const { tool } = state.call
    if (state.result?.status !== 'done' || tool.kind !== 'edit') {
      continue
    }
    const file = files.get(tool.path) ?? { path: tool.path, added: 0, removed: 0, calls: [] }
    const changes = lineChanges(state.call)
    file.added += changes?.added ?? 0
    file.removed += changes?.removed ?? 0
    if (tool.change?.type === 'diff' && tool.change.op !== 'update') {
      file.op = tool.change.op
    }
    file.calls.push(state)
    files.set(tool.path, file)
  }
  return [...files.values()]
}
