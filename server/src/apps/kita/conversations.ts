import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import path from 'node:path'
import { notifyChange } from '../../events.js'
import { appDir } from '../../paths.js'
import { forApp } from '../../services/kita/index.js'
import type { KitaSession } from '../../services/kita/index.js'
import { transcriptPrompt } from '../../services/kita/transcript-prompt.js'
import type { AgentId } from '../../services/kita/types.js'
import type { Conversation } from './types.js'

export const kita = forApp('kita')

// 每个对话一个工作目录，和 binOS 的代码分开，对话之间也互相看不到对方留下的文件
const workspacesDir = path.join(appDir('kita'), 'workspaces')

// 喜多 app 的对话读写个人范围的记忆
const identity = { read: ['personal'], write: 'personal' }

// 一轮开始和结束时通知页面重新读取列表
kita.onEvent((_session, event) => {
  if (event.type === 'event' && (event.event.data.type === 'input' || event.event.data.type === 'turn_end')) {
    notifyChange({ type: 'kita' })
  }
})

function conversation(session: KitaSession): Conversation {
  const summary = session.summary()
  const first = session.entries().find((entry) => entry.type === 'input')
  return {
    id: session.id,
    title: (first?.type === 'input' ? first.text.trim() : '').slice(0, 100),
    temporary: !session.metadata().identity,
    agent: summary.agent,
    state: summary.state,
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
    ...(summary.outcome && { outcome: summary.outcome }),
  }
}

export const listConversations = () => kita.listSessions().map(conversation).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))

// 返回对话的 id；交不过去时返回 undefined
export async function startConversation(text: string, temporary: boolean, agent: AgentId): Promise<string | undefined> {
  mkdirSync(workspacesDir, { recursive: true })
  const cwd = mkdtempSync(path.join(workspacesDir, 'conversation-'))
  const session = kita.createSession({ agent, cwd, instructions: transcriptPrompt, ...(!temporary && { identity }) })
  notifyChange({ type: 'kita' })
  return (await session.send({ text })) ? session.id : undefined
}

// 正在回答时交给 agent，它在下一步看到
export async function sendMessage(id: string, text: string): Promise<boolean> {
  return (await kita.getSession(id)?.send({ text })) ?? false
}

export const stopConversation = (id: string) => kita.getSession(id)?.stop() ?? false

// 对话的工作目录一起删掉
export async function deleteConversation(id: string): Promise<boolean> {
  const cwd = kita.getSession(id)?.metadata().cwd
  const deleted = await kita.deleteSession(id)
  if (!deleted) return false
  if (cwd && path.dirname(cwd) === workspacesDir) rmSync(cwd, { recursive: true, force: true })
  notifyChange({ type: 'kita' })
  return true
}
