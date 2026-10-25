import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { defaultProject } from './projects.js'
import { appDir } from '../../paths.js'
import { codeKita } from './kita.js'
import type { KitaSession } from '../../services/kita/index.js'
import type { SearchResult, SearchResults } from './types.js'

// session.json：对话对应的 thread 和用户在列表上的整理（改的名字、置顶、归档、最后一次看它的时间），
// 以及从 thread 的条目里算出的（scanned 是算到了第几条）：默认的标题，开过的 PR 和还没有结果的 gh pr create 调用
export type Session = {
  kitaSession: string
  project: string
  title?: string
  pinned?: true
  archived?: true
  readAt?: string
  scanned: number
  defaultTitle: string
  prs: string[]
  creatingPrs: string[]
}

type UserState = Pick<Session, 'title' | 'pinned' | 'archived' | 'readAt'>

const prUrlPattern = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/g

export const dataDir = appDir('code')
const sessionsDir = path.join(dataDir, 'sessions')

export const sessionDir = (id: number) => path.join(sessionsDir, String(id))
const sessionPath = (id: number) => path.join(sessionDir(id), 'session.json')

export function listSessions(): number[] {
  if (!existsSync(sessionsDir)) {
    return []
  }
  return readdirSync(sessionsDir)
    .filter((name) => /^\d+$/.test(name))
    .map(Number)
    .filter(sessionExists)
    .sort((a, b) => b - a)
}

export function sessionExists(id: number): boolean {
  return Number.isSafeInteger(id) && id > 0 && existsSync(sessionPath(id))
}

// 先写临时文件再改名，不会出现写了一半的 session.json
function writeSession(id: number, session: Session) {
  writeFileSync(`${sessionPath(id)}.tmp`, JSON.stringify(session, null, 2) + '\n')
  renameSync(`${sessionPath(id)}.tmp`, sessionPath(id))
}

// 只有这个后端写 session（根目录锁保证），同步地建目录、写 session.json，编号不会被占
export function createSession(thread: string, project = defaultProject): number {
  const id = (listSessions()[0] ?? 0) + 1
  mkdirSync(sessionDir(id), { recursive: true })
  writeSession(id, { kitaSession: thread, project, scanned: 0, defaultTitle: '', prs: [], creatingPrs: [] })
  sessionIds.set(thread, id)
  return id
}

const sessions = new Map<number, Session>()

// 从上次算到的地方接着看 thread 新增的条目
export function readSession(id: number): Session {
  const session = sessions.get(id) ?? (JSON.parse(readFileSync(sessionPath(id), 'utf8')) as Session)
  sessions.set(id, session)
  const items = sessionThread(id, session).entries(session.scanned)
  if (items.length === 0) {
    return session
  }
  for (const item of items) {
    if (item.type === 'input' && item.mode === 'start' && !session.defaultTitle) {
      session.defaultTitle = (item.text.trim() || item.attachments?.[0]?.name || '').slice(0, 200)
    } else if (item.type === 'tool_call' && item.tool.kind === 'command' && item.tool.command.includes('gh pr create')) {
      session.creatingPrs.push(item.id)
    } else if (item.type === 'tool_result' && session.creatingPrs.includes(item.callId)) {
      session.creatingPrs = session.creatingPrs.filter((callId) => callId !== item.callId)
      for (const url of item.output?.match(prUrlPattern) ?? []) {
        if (!session.prs.includes(url)) {
          session.prs.push(url)
        }
      }
    }
  }
  session.scanned += items.length
  writeSession(id, session)
  return session
}

export const sessionTitle = (session: Session) => session.title ?? session.defaultTitle

function sessionThread(id: number, session: Session): KitaSession {
  const thread = codeKita.getSession(session.kitaSession)
  if (!thread) {
    throw new Error(`session ${id} 的 thread ${session.kitaSession} 不存在`)
  }
  return thread
}

export const threadOf = (id: number) => sessionThread(id, readSession(id))

// 改用户的整理，值为 undefined 的去掉这一项
export function setUserState(id: number, state: { [K in keyof UserState]?: UserState[K] | undefined }) {
  const session = readSession(id)
  for (const [key, value] of Object.entries(state) as [keyof UserState, string | true | undefined][]) {
    if (value === undefined) {
      delete session[key]
    } else {
      Object.assign(session, { [key]: value })
    }
  }
  writeSession(id, session)
}

// thread → session 编号
const sessionIds = new Map<string, number>()

export function sessionOf(thread: string): number | undefined {
  if (sessionIds.size === 0) {
    for (const id of listSessions()) {
      sessionIds.set(readSession(id).kitaSession, id)
    }
  }
  return sessionIds.get(thread)
}

// 标题、用户的话或回复的文字里含有 query（不分大小写）的 session
export function searchSessions(ids: number[], query: string): Set<number> {
  const needle = query.toLowerCase()
  const includes = (text: string) => text.toLowerCase().includes(needle)
  return new Set(
    ids.filter(
      (id) =>
        includes(sessionTitle(readSession(id))) ||
        threadOf(id)
          .entries()
          .some((item) => (item.type === 'input' || (item.type === 'text' && !item.parent)) && includes(item.text)),
    ),
  )
}

export function searchContent(query: string): SearchResults {
  const needle = query.trim().toLowerCase()
  const results: SearchResult[] = []
  let total = 0
  if (!needle) return { results, total }
  const add = (id: number, text: string, kind: 'title' | 'input' | 'text', item?: number) => {
    const at = text.toLowerCase().indexOf(needle)
    if (at < 0) return
    total++
    if (results.length >= 200) return
    const session = readSession(id)
    results.push({
      id, title: sessionTitle(session), archived: Boolean(session.archived), kind,
      ...(item !== undefined && { item }),
      before: (at > 50 ? '…' : '') + text.slice(Math.max(0, at - 50), at),
      match: text.slice(at, at + needle.length),
      after: text.slice(at + needle.length, at + needle.length + 100) + (text.length > at + needle.length + 100 ? '…' : ''),
    })
  }
  const ids = listSessions().sort((a, b) => threadOf(b).summary().updatedAt.localeCompare(threadOf(a).summary().updatedAt))
  for (const id of ids) {
    add(id, sessionTitle(readSession(id)), 'title')
    threadOf(id).entries().forEach((item, index) => {
      if (item.type === 'input' || (item.type === 'text' && !item.parent)) add(id, item.text, item.type, index)
    })
  }
  return { results, total }
}
