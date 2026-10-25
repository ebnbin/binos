import { expect, it } from 'vitest'
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

it('跨轮重复的工具和子 agent id 不会串结果或子条目', () => {
  const first = makeTurn('first'), second = makeTurn('second')
  const turns = splitTurns([...first, ...second])
  expect(turns).toHaveLength(2)
  for (const [turn, entries, output] of [[turns[0], first, 'first'], [turns[1], second, 'second']] as const) {
    const parent = entries[1], child = entries[2]
    if (parent.type !== 'tool_call' || child.type !== 'tool_call') throw Error('expected call')
    expect(turn.results.get(parent)?.output).toBe(output)
    expect(turn.results.get(child)?.output).toBe(output)
    expect(turn.children.get(parent)?.map(({ item }) => item)).toEqual([child, entries[3]])
  }
  expect(turns.flatMap((turn) => turn.main.map(({ index }) => index))).toEqual([0, 1, 4, 5, 6, 7, 10, 11])
})

it('追加条目时沿用没变的轮，换了条目的不沿用', () => {
  const first = makeTurn('first'), second = makeTurn('second')
  const before = splitTurns([...first, ...second.slice(0, 2)])
  const after = splitTurns([...first, ...second], before)
  expect(after[0]).toBe(before[0])
  expect(after[1]).not.toBe(before[1])
  expect(splitTurns(makeTurn('first'), after)[0]).not.toBe(after[0])
})

it('往前补上更早的轮后，原来的轮位置不变、沿用原来的对象', () => {
  const first = makeTurn('first'), second = makeTurn('second')
  const before = splitTurns(second, [], first.length)
  const after = splitTurns([...first, ...second], before, 0)
  expect(after.map((turn) => turn.start)).toEqual([0, first.length])
  expect(after[1]).toBe(before[0])
  expect(after[1].main[0].index).toBe(first.length)
})
