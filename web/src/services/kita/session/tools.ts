import type { BrowserOperation, Entry, LineCount } from '@binos/server/services/kita/types'
import type { Icon } from '@phosphor-icons/react'
import { AppWindowIcon, FilePlusIcon, FileTextIcon, GlobeIcon, ImageIcon, ListChecksIcon, MagnifyingGlassIcon, PackageIcon, PencilSimpleLineIcon, RobotIcon, SparkleIcon, TerminalWindowIcon, WrenchIcon } from '@phosphor-icons/react'

export type ToolCall = Extract<Entry, { type: 'tool_call' }>
export type ToolResult = Extract<Entry, { type: 'tool_result' }>
// seq：调用事件的位置；itemId：调用和结果共用的；live：这一轮还在回答，没有结果的调用还在运行
export type CallState = { call: ToolCall; seq: number; itemId: string; result: ToolResult | undefined; live: boolean }

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
type ToolLabel = { icon: Icon; verb: string; category: ToolCategory; detail?: string }

// 浏览器操作的说法，认不出的直接用工具名
const browserVerbs: Record<Exclude<BrowserOperation, 'other'>, string> = {
  navigate: '浏览器打开',
  interact: '操作浏览器',
  script: '在浏览器里执行脚本',
  read: '读取页面',
  find: '在页面里查找',
  fill: '填写表单',
  console: '查看控制台',
  network: '查看网络请求',
  tabs: '查看标签页',
  'open-tab': '新建标签页',
  'close-tab': '关闭标签页',
}

export function toolLabel({ name, tool }: ToolCall): ToolLabel {
  switch (tool.kind) {
    case 'command':
      return { icon: TerminalWindowIcon, verb: '运行', category: 'command', detail: tool.command }
    case 'read':
      return { icon: FileTextIcon, verb: '查看', category: 'read', detail: tool.path }
    case 'edit':
      return tool.change?.type === 'write'
        ? { icon: FilePlusIcon, verb: '写入', category: 'edit', detail: tool.path }
        : { icon: PencilSimpleLineIcon, verb: '修改', category: 'edit', detail: tool.path }
    case 'search':
      return { icon: MagnifyingGlassIcon, verb: tool.target === 'files' ? '查找文件' : '搜索', category: 'search', detail: tool.pattern }
    case 'web_search':
      return { icon: GlobeIcon, verb: '搜索网页', category: 'search', detail: tool.query }
    case 'web_fetch':
      return { icon: GlobeIcon, verb: '打开网页', category: 'web', detail: tool.url }
    case 'image_view':
      return { icon: ImageIcon, verb: '查看图片', category: 'read', detail: tool.path }
    case 'browser':
      return { icon: AppWindowIcon, verb: tool.operation && tool.operation !== 'other' ? browserVerbs[tool.operation] : `浏览器 ${tool.action}`, category: 'browser', detail: tool.target }
    case 'mcp':
      return { icon: WrenchIcon, verb: `${tool.server} ${tool.tool}`, category: 'other', detail: tool.target }
    case 'subagent':
      return { icon: RobotIcon, verb: '子 agent', category: 'subagent', detail: tool.description }
    case 'tool_search':
      return { icon: PackageIcon, verb: '加载工具', category: 'other', detail: tool.query }
    case 'skill':
      return { icon: SparkleIcon, verb: '使用技能', category: 'other', detail: tool.name }
    case 'todo':
      return { icon: ListChecksIcon, verb: '更新待办', category: 'other' }
    case 'other':
      return { icon: WrenchIcon, verb: name, category: 'other', detail: tool.target }
  }
}

// 一轮里改过的一个文件：增删的行数合计，以及改它的每一次调用。op 是新建或删除了它
export type FileChange = LineCount & { path: string; op?: 'add' | 'delete'; calls: CallState[] }

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
    file.added += tool.lines?.added ?? 0
    file.removed += tool.lines?.removed ?? 0
    if (tool.change?.type === 'diff' && tool.change.op !== 'update') {
      file.op = tool.change.op
    }
    file.calls.push(state)
    files.set(tool.path, file)
  }
  return [...files.values()]
}
