import { randomUUID } from 'node:crypto'
import {
  appendFileSync,
  closeSync,
  existsSync,
  fstatSync,
  ftruncateSync,
  mkdirSync,
  openSync,
  readdirSync,
  rmSync,
  readFileSync,
  readSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { kitaServiceDir } from '../../paths.js'
import { drivers } from './drivers/index.js'
import { encodeEntries } from './journal.js'
import type { Event, EventBatch, SessionMetadata } from './journal.js'
import { defaultAgent } from './types.js'
import type { AgentId, Context, Entry, Tokens } from './types.js'

export const sessionsDir = path.join(kitaServiceDir, 'sessions')
export const sessionDir = (id: string) => path.join(sessionsDir, id)
export const filesDir = (id: string) => path.join(sessionDir(id), 'files')
export const hostDir = (id: string) => path.join(sessionDir(id), 'host')
export const eventsPath = (id: string) => path.join(sessionDir(id), 'events.jsonl')
const metadataPath = (id: string) => path.join(sessionDir(id), 'metadata.json')
const infoPath = (id: string) => path.join(sessionDir(id), 'summary.json')
const infoVersion = 1

export function workerDir(id: string): string {
  const file = path.join(sessionDir(id), 'runtime.json')
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as { workerDir: string }).workerDir : hostDir(id)
}

export function unbindWorker(id: string) {
  rmSync(path.join(sessionDir(id), 'runtime.json'), { force: true })
}

export function metadata(id: string): SessionMetadata {
  const value: SessionMetadata = JSON.parse(readFileSync(metadataPath(id), 'utf8'))
  if (value.format !== 1 || value.id !== id) throw new Error(`Kita session ${id} 的格式不正确`)
  return value
}

export type KitaSessionInfo = {
  version: number
  itemsSize: number
  count: number
  agent: AgentId
  owner: string
  cwd: string
  instructions?: string
  createdAt: string
  updatedAt: string
  turns: number
  // 最后一轮还没结束，以及它开始的时间
  inTurn: boolean
  turnStartedAt?: string
  outcome?: 'stopped' | 'error'
  context?: Context
  // 最近一轮结束的时间
  repliedAt?: string
  // 最近一轮用的模型和思考程度
  model?: string
  effort?: string
  // agent 那边的会话，agent 进程重新启动时接着它
  agentSession?: string
  // 用掉的 token，按模型：每一轮结束时报告的是 agent 那边的会话到这时为止的累计（usageLatest），
  // agent 那边换了会话（比如接不上了重开）时，之前的累计并进 usageBefore
  usageBefore: Record<string, Tokens>
  usageLatest: Record<string, Tokens>
  // 每一轮按 API 价格折算的花费（美元）和这一轮结束的时间，只有能折算的 agent 有
  costs: [time: string, cost: number][]
}

export function addUsage(a: Record<string, Tokens>, b: Record<string, Tokens>): Record<string, Tokens> {
  const sum = { ...a }
  for (const [model, tokens] of Object.entries(b)) {
    const base = sum[model] ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
    sum[model] = {
      input: base.input + tokens.input,
      output: base.output + tokens.output,
      cacheRead: base.cacheRead + tokens.cacheRead,
      cacheWrite: base.cacheWrite + tokens.cacheWrite,
    }
  }
  return sum
}

export function listKitaSessions(): string[] {
  return existsSync(sessionsDir) ? readdirSync(sessionsDir).filter(kitaSessionExists) : []
}

export function kitaSessionExists(id: string): boolean {
  return /^[\w-]+$/.test(id) && existsSync(metadataPath(id)) && existsSync(eventsPath(id))
}

// 只有这个后端写 session（根目录锁保证），建目录、写第一条之后才算有了这个 session
export function createKitaSession(first: Extract<Entry, { type: 'session' }>): string {
  const id = randomUUID()
  mkdirSync(sessionDir(id), { recursive: true })
  writeFileSync(metadataPath(id), JSON.stringify({ ...first, format: 1, id }) + '\n', { flush: true })
  appendEntries(id, [first])
  return id
}

export function removeKitaSession(id: string) {
  rmSync(sessionDir(id), { recursive: true, force: true })
  journals.delete(id)
  infos.delete(id)
}

// 只容忍最后未提交的半行；中间的损坏必须报错，不能把损坏的历史当成有效会话。
function readJournal(id: string): Event[] {
  metadata(id)
  const size = statSync(eventsPath(id)).size
  const cached = journals.get(id)
  if (cached?.size === size) return cached.events
  const lines = readFileSync(eventsPath(id), 'utf8').split('\n')
  const events: Event[] = []
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i] || i === lines.length - 1) continue
    let batch: EventBatch
    try {
      batch = JSON.parse(lines[i]) as EventBatch
    } catch (error) {
      if (i === lines.length - 1) break
      throw error
    }
    if (!Array.isArray(batch.events)) throw new Error(`Kita session ${id} 的事件批次损坏`)
    for (const event of batch.events) {
      if (event.seq !== events.length + 1 || !event.id || !event.data) throw new Error(`Kita session ${id} 的事件序号损坏`)
      events.push(event)
    }
  }
  journals.set(id, { size, events })
  return events
}

export function readEvents(id: string, from = 0, to?: number): Event[] {
  return structuredClone(readJournal(id).slice(from, to))
}

// 分段读取的起点：before（默认到最后）之前 size 条所在的一轮的开头（mode 为 start 的 input），前面没有一轮时是 0。
// 页面按轮显示，每段都从一轮的开头读起
export function windowStart(id: string, size: number, before?: number): number {
  const events = readJournal(id)
  for (let i = Math.min((before ?? events.length) - size, events.length - 1); i > 0; i--) {
    const { data } = events[i]
    if (data.type === 'input' && data.mode === 'start') return i
  }
  return 0
}

const journals = new Map<string, { size: number; events: Event[] }>()

export type CallDetail = { call: Entry; result?: Entry }

// index 处的工具调用和它的结果（在同一轮里按调用 id 对应），不是工具调用时返回 undefined
export function readCall(id: string, index: number): CallDetail | undefined {
  const events = readJournal(id)
  const call = events[index]
  if (call?.data.type !== 'tool_call') return undefined
  const callId = call.data.id
  const result = events.slice(index + 1).find(({ turnId, data }) => turnId === call.turnId && data.type === 'tool_result' && data.callId === callId)
  return structuredClone({ call: call.data, ...(result && { result: result.data }) })
}

export function readEntries(id: string, from = 0): Entry[] {
  return readEvents(id, from).map((event) => event.data)
}

function emptyInfo(): KitaSessionInfo {
  return {
    version: infoVersion,
    itemsSize: 0,
    count: 0,
    agent: defaultAgent,
    owner: '',
    cwd: '',
    createdAt: '',
    updatedAt: '',
    turns: 0,
    inTurn: false,
    usageBefore: {},
    usageLatest: {},
    costs: [],
  }
}

const usageCost = (agent: AgentId, usage: Record<string, Tokens>) => {
  const cost = drivers[agent].cost
  return cost ? Object.entries(usage).reduce((sum, [model, tokens]) => sum + cost(model, tokens), 0) : 0
}

function apply(info: KitaSessionInfo, item: Entry) {
  info.count += 1
  info.createdAt ||= item.time
  info.updatedAt = item.time
  switch (item.type) {
    case 'session':
      info.agent = item.agent
      info.owner = item.owner
      info.cwd = item.cwd
      if (item.instructions) {
        info.instructions = item.instructions
      }
      break
    case 'input':
      if (item.mode === 'start') {
        info.turns += 1
        info.inTurn = true
        info.turnStartedAt = item.time
        delete info.outcome
        info.model = item.model
        info.effort = item.effort
      }
      break
    case 'agent_session':
      if (info.agentSession && info.agentSession !== item.id) {
        info.usageBefore = addUsage(info.usageBefore, info.usageLatest)
        info.usageLatest = {}
      }
      info.agentSession = item.id
      break
    case 'turn_end':
      info.inTurn = false
      delete info.turnStartedAt
      info.repliedAt = item.time
      if (item.outcome) {
        info.outcome = item.outcome
      }
      if (item.context) {
        info.context = item.context
      }
      if (item.usage) {
        const cost = usageCost(info.agent, item.usage) - usageCost(info.agent, info.usageLatest)
        info.usageLatest = item.usage
        if (cost > 0) {
          info.costs.push([item.time, cost])
        }
      }
      break
  }
}

// 先写临时文件再改名，不会出现写了一半的 summary.json
function writeInfo(id: string, info: KitaSessionInfo) {
  writeFileSync(`${infoPath(id)}.tmp`, JSON.stringify(info, null, 2) + '\n')
  renameSync(`${infoPath(id)}.tmp`, infoPath(id))
}

function readInfoFile(id: string): KitaSessionInfo | undefined {
  try {
    return JSON.parse(readFileSync(infoPath(id), 'utf8'))
  } catch {
    return undefined
  }
}

function itemsSize(id: string): number {
  try {
    return statSync(eventsPath(id)).size
  } catch {
    return 0
  }
}

// 内存里记着每个 session 算到哪了，追加时接着算；后端刚启动时先看 summary.json，和 events.jsonl 对得上就直接用
const infos = new Map<string, KitaSessionInfo>()

function cachedInfo(id: string): KitaSessionInfo {
  const size = itemsSize(id)
  const cached = infos.get(id) ?? readInfoFile(id)
  if (cached?.itemsSize === size && cached.version === infoVersion) {
    infos.set(id, cached)
    return cached
  }
  const info = emptyInfo()
  for (const item of readEntries(id)) {
    apply(info, item)
  }
  info.itemsSize = size
  writeInfo(id, info)
  infos.set(id, info)
  return info
}

export function sessionInfo(id: string): KitaSessionInfo {
  return structuredClone(cachedInfo(id))
}

// 崩溃留下的最后半行不属于已提交批次；追加前截断它，避免把新数据接到半行后。
function repairTail(id: string) {
  if (!existsSync(eventsPath(id))) return
  const fd = openSync(eventsPath(id), 'r+')
  try {
    const size = fstatSync(fd).size
    if (!size) return
    const last = Buffer.alloc(1)
    readSync(fd, last, 0, 1, size - 1)
    if (last[0] === 10) return
    let cursor = size
    while (cursor > 0) {
      const length = Math.min(cursor, 4096)
      const bytes = Buffer.alloc(length)
      cursor -= length
      readSync(fd, bytes, 0, length, cursor)
      const end = bytes.lastIndexOf(10)
      if (end >= 0) { ftruncateSync(fd, cursor + end + 1); return }
    }
    ftruncateSync(fd, 0)
  } finally {
    closeSync(fd)
  }
}

export function appendEntries(id: string, entries: Entry[]): number {
  entries = structuredClone(entries)
  repairTail(id)
  const exists = existsSync(eventsPath(id))
  const info = exists ? cachedInfo(id) : emptyInfo()
  const previous = exists ? readJournal(id).at(-1) : undefined
  const index = info.count
  const batch: EventBatch = { events: encodeEntries(entries, previous) }
  appendFileSync(eventsPath(id), JSON.stringify(batch) + '\n', { flush: true })
  const cached = journals.get(id)
  if (cached) {
    cached.events.push(...batch.events)
    cached.size = itemsSize(id)
  }
  for (const entry of entries) apply(info, entry)
  info.itemsSize = itemsSize(id)
  writeInfo(id, info)
  infos.set(id, info)
  return index
}
