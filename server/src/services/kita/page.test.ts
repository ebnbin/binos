import { expect, it } from 'vitest'
import { clipEvent, encodeEntries } from './journal.js'
import { pageEvents } from './page.js'
import type { Entry } from './types.js'

const time = new Date().toISOString()
const journal = (entries: Entry[]) => encodeEntries([{ type: 'session', time, agent: 'claude', owner: 'test', cwd: '/' }, { type: 'input', time, mode: 'start', text: '' }, ...entries], undefined)

it('Claude 的读文件和网页搜索结果认出结构，结果对得上它的调用', () => {
  const events = journal([
    { type: 'tool_call', time, id: 'read', name: 'Read', tool: { kind: 'read', path: '/a.ts' } },
    { type: 'tool_call', time, id: 'search', name: 'WebSearch', tool: { kind: 'web_search', query: 'q' } },
    { type: 'tool_result', time, callId: 'search', status: 'done', output: 'Web search results for query: "q"\n\nLinks: [{"title":"A","url":"https://a.example/"},{"url":"https://b.example/"}]\n\n总结' },
    { type: 'tool_result', time, callId: 'read', status: 'done', output: '  41\tconst a = 1\n  42\t' },
  ])
  const [search, read] = pageEvents('claude', events).slice(-2).map((event) => event.data)
  expect(search).toMatchObject({ output: '总结', links: [{ title: 'A', url: 'https://a.example/' }, { title: 'https://b.example/', url: 'https://b.example/' }] })
  expect(read).toMatchObject({ output: 'const a = 1\n', startLine: 41 })
})

it('省略读文件结果的开头时，起始行号跟着往后挪', () => {
  const lines = Array.from({ length: 200 }, (_, i) => `${i + 1}\tline ${i + 1}`)
  const events = journal([
    { type: 'tool_call', time, id: 'read', name: 'Read', tool: { kind: 'read', path: '/a.ts' } },
    { type: 'tool_result', time, callId: 'read', status: 'done', output: lines.join('\n') },
  ])
  const { data } = clipEvent(pageEvents('claude', events).at(-1)!)
  if (data.type !== 'tool_result') throw new Error('expected result')
  expect(data.output!.split('\n')[0]).toBe(`line ${data.startLine}`)
})

it('改文件的调用带上增删的行数，turn_end 带上模型的显示名', () => {
  const events = journal([
    { type: 'tool_call', time, id: 'edit', name: 'Edit', tool: { kind: 'edit', path: '/a', change: { type: 'replace', before: 'a\nb\n', after: 'a\nc\nd\n' } } },
    { type: 'tool_call', time, id: 'patch', name: 'apply_patch', tool: { kind: 'edit', path: '/b', change: { type: 'diff', op: 'update', diff: '--- a\n+++ b\n@@\n-x\n+y\n+z\n' } } },
    { type: 'turn_end', time, durationMs: 1, model: 'claude-opus-5-5' },
  ])
  const pages = pageEvents('claude', events).slice(-3).map((event) => event.data)
  expect(pages.map((data) => data.type === 'tool_call' && data.tool.kind === 'edit' && data.tool.lines)).toEqual([{ added: 2, removed: 1 }, { added: 2, removed: 1 }, false])
  expect(pages[2]).toMatchObject({ modelName: 'Opus 5.5' })
})
