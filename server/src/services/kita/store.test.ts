import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = mkdtempSync(path.join(os.tmpdir(), 'binos-test-'))
process.env.BINOS_ROOT = root
const { encodeEntries } = await import('./journal.js')
const { readCall, readEvents, appendEntries, createKitaSession, readEntries, sessionDir, sessionInfo, windowStart } = await import('./store.js')
const time = () => new Date().toISOString()
const input = (text: string, mode: 'start' | 'steer' = 'start') => ({ type: 'input' as const, time: time(), mode, text })
const turnEnd = () => ({ type: 'turn_end' as const, time: time(), durationMs: 0 })
const newThread = () => createKitaSession({ type: 'session', time: time(), agent: 'claude', owner: 'test', cwd: root })

describe('store', () => {
  it('分段读取从一轮的开头读起，插话不算一轮的开头', () => {
    const id = newThread()
    appendEntries(id, [input('一'), turnEnd(), input('二'), input('插话', 'steer'), turnEnd(), input('三'), turnEnd()])
    expect(windowStart(id, 1)).toBe(6)
    expect(windowStart(id, 3)).toBe(3)
    expect(windowStart(id, 2, 6)).toBe(3)
    expect(windowStart(id, 3, 3)).toBe(0)
    expect(windowStart(id, 100)).toBe(0)
    expect(windowStart(id, 7)).toBe(0)
  })

  it('按位置读调用时只在同一轮里找结果，不同轮的调用 id 可能相同', () => {
    const id = newThread()
    const call = (text: string) => ({ type: 'tool_call' as const, time: time(), id: 'call-1', name: 'Bash', tool: { kind: 'command' as const, command: text } })
    const result = (output: string) => ({ type: 'tool_result' as const, time: time(), callId: 'call-1', status: 'done' as const, output })
    appendEntries(id, [input('一'), call('ls'), turnEnd(), input('二'), call('pwd'), result('/tmp'), turnEnd()])
    expect(readCall(id, 3)).toEqual({ call: expect.objectContaining({ data: expect.objectContaining({ tool: { kind: 'command', command: 'ls' } }) }) })
    expect(readCall(id, 6)?.result?.data).toMatchObject({ output: '/tmp' })
    expect(readCall(id, 2)).toBeUndefined()
  })

  it('summary.json 和 events.jsonl 对不上时从头重算；一轮进行中的 input 是插话，不算新的一轮', () => {
    const id = newThread()
    expect(appendEntries(id, [input('一'), input('插话', 'steer'), turnEnd(), input('二')])).toBe(1)
    expect(sessionInfo(id)).toMatchObject({ count: 5, turns: 2, inTurn: true, owner: 'test' })
    rmSync(path.join(sessionDir(id), 'summary.json'))
    appendFileSync(path.join(sessionDir(id), 'events.jsonl'), JSON.stringify({ events: encodeEntries([turnEnd()], readEvents(id).at(-1)) }) + '\n')
    expect(sessionInfo(id)).toMatchObject({ count: 6, turns: 2, inTurn: false })
  })

  it('输入、读取的事件与摘要都是独立快照，嵌套修改不会污染历史或缓存', () => {
    const id = newThread()
    const entry = { ...input('原始'), attachments: [{ name: '原始文件', file: 'a.txt' }] }
    appendEntries(id, [entry])
    const disk = readFileSync(path.join(sessionDir(id), 'events.jsonl'), 'utf8')
    entry.text = '输入被修改'
    entry.attachments[0].name = '输入文件被修改'
    const events = readEvents(id)
    events[0].seq = 999
    const data = events[1].data
    if (data.type !== 'input') throw new Error('缺少 input')
    data.text = '读取被修改'
    data.attachments![0].name = '读取文件被修改'
    const entries = readEntries(id)
    if (entries[1].type !== 'input') throw new Error('缺少 input')
    entries[1].text = '条目被修改'
    const info = sessionInfo(id)
    info.owner = '其他应用'
    info.usageLatest.fake = { input: 1, output: 0, cacheRead: 0, cacheWrite: 0 }
    expect(readEvents(id)[0].seq).toBe(1)
    expect(readEntries(id)[1]).toMatchObject({ text: '原始', attachments: [{ name: '原始文件' }] })
    expect(sessionInfo(id).owner).toBe('test')
    expect(sessionInfo(id).usageLatest).toEqual({})
    expect(readFileSync(path.join(sessionDir(id), 'events.jsonl'), 'utf8')).toBe(disk)
    appendEntries(id, [turnEnd()])
    expect(sessionInfo(id)).toMatchObject({ count: 3, owner: 'test', inTurn: false })
  })

  it('换了 agent 那边的会话时，之前累计的用量另记，按 API 价格折算每一轮的花费', () => {
    const id = newThread()
    const tokens = { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 }
    appendEntries(id, [
      { type: 'agent_session', time: time(), id: 'a' },
      { ...turnEnd(), usage: { opus: tokens } },
      { type: 'agent_session', time: time(), id: 'b' },
      { ...turnEnd(), usage: { opus: tokens } },
    ])
    const info = sessionInfo(id)
    expect(info.usageBefore).toEqual({ opus: tokens })
    expect(info.usageLatest).toEqual({ opus: tokens })
    expect(info.costs.map(([, cost]) => cost)).toEqual([4, 4])
  })

  it('跳过崩溃时没写完的半行，之后的条目另起一行', () => {
    const id = newThread()
    appendFileSync(path.join(sessionDir(id), 'events.jsonl'), '{"type":"in')
    expect(appendEntries(id, [input('二')])).toBe(1)
    expect(readEntries(id).map((item) => item.type)).toEqual(['session', 'input'])
    expect(readFileSync(path.join(sessionDir(id), 'events.jsonl'), 'utf8').split('\n')).toHaveLength(3)
  })
})
