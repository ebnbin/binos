import type { BuiltinApp } from '../types.js'

// 内置 app 的 id 和名称。activity、记忆的范围和来源里只有 app 的 id，客户端按这份显示名称
export const builtinApps: BuiltinApp[] = [
  { id: 'calendar', name: '日历' },
  { id: 'music', name: '音乐' },
  { id: 'browser', name: '浏览器' },
  { id: 'terminal', name: '终端' },
  { id: 'files', name: '文件' },
  { id: 'code', name: 'Code' },
  { id: 'kita', name: '喜多' },
  { id: 'system', name: '系统' },
]
