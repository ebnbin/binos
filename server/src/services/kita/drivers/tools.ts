import type { BrowserOperation, ToolDetail } from '../types.js'

// 浏览器扩展（Claude in Chrome）的 MCP 服务：action 取工具名，target 取这个参数
const browserServer = 'claude-in-chrome'
const browserTargets: Record<string, string> = {
  navigate: 'url',
  computer: 'action',
  javascript_tool: 'text',
  find: 'query',
  read_console_messages: 'pattern',
}

// MCP 工具的调用归类，各个 agent 一样：浏览器扩展的是 browser，其余是 mcp
export function mcpTool(server: string, tool: string, input: Record<string, unknown>): { tool: ToolDetail; input: unknown } {
  if (server === browserServer) {
    const target = browserTargets[tool] && input[browserTargets[tool]]
    return { tool: { kind: 'browser', action: tool, ...(typeof target === 'string' && { target }) }, input }
  }
  return { tool: { kind: 'mcp', server, tool }, input }
}

const browserOperations: Record<string, BrowserOperation> = {
  navigate: 'navigate',
  computer: 'interact',
  browser_batch: 'interact',
  javascript_tool: 'script',
  read_page: 'read',
  get_page_text: 'read',
  find: 'find',
  form_input: 'fill',
  read_console_messages: 'console',
  read_network_requests: 'network',
  tabs_context_mcp: 'tabs',
  tabs_create_mcp: 'open-tab',
  tabs_close_mcp: 'close-tab',
}

// 浏览器工具归到哪类操作
export const browserOperation = (action: string): BrowserOperation => browserOperations[action] ?? 'other'
