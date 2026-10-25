import { expect, it } from 'vitest'
import { encodeEntries, pageEvent } from '@binos/server/services/kita/journal'
import type { PageEvent } from '@binos/server/services/kita/journal'
import type { Entry } from '@binos/server/services/kita/types'
import { splitTurns } from './transcript-index.ts'

const time = new Date().toISOString()
const makeTurn = (text: string): Entry[] => [
  { type: 'input', time, mode: 'start', text },
  { type: 'tool_call', time, id: 'parent', name: 'agent', tool: { kind: 'other' } },
  { type: 'tool_call', time, id: 'child', parent: 'parent', name: 'shell', tool: { kind: 'command', command: text } },
  { type: 'tool_result', time, callId: 'child', parent: 'parent', status: 'done', output: text },
  { type: 'tool_result', time, callId: 'parent', status: 'done', output: text },
  { type: 'turn_end', time, durationMs: 1 },
]
const session: Entry = { type: 'session', time, agent: 'claude', owner: 'test', cwd: '/' }
const encode = (entries: Entry[], previous?: PageEvent[]): PageEvent[] => {
  const last = previous?.at(-1)
  return encodeEntries(entries, last && { ...last, id: '', type: 'item.added' }).map(pageEvent)
}

it('事件按轮分组，结果和子 agent 的条目按 itemId、parentId 归到所属的调用', () => {
  const events = encode([session, ...makeTurn('first'), ...makeTurn('second')])
  const turns = splitTurns(events)
  expect(turns.map((turn) => turn.size)).toEqual([1, 6, 6])
  for (const [turn, output] of [[turns[1], 'first'], [turns[2], 'second']] as const) {
    const parent = turn.main[1]
    expect(turn.results.get(parent.itemId!)?.output).toBe(output)
    expect(turn.children.get(parent.itemId!)?.map(({ data }) => data.type)).toEqual(['tool_call', 'tool_result'])
  }
  expect(turns[2].main.map(({ seq }) => seq)).toEqual([8, 9, 12, 13])
})

it('往两头增加事件时沿用没变的轮', () => {
  const first = encode([session, ...makeTurn('first')])
  const second = encode(makeTurn('second'), first)
  const before = splitTurns([...first, ...second.slice(0, 2)])
  const after = splitTurns([...first, ...second], before)
  expect(after[1]).toBe(before[1])
  expect(after[2]).not.toBe(before[2])
  const older = splitTurns(second)
  expect(splitTurns([...first, ...second], older)[2]).toBe(older[0])
})
