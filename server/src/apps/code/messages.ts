import { codeKita } from './kita.js'
import { codeInstructions } from './instructions.js'
import { notifyChange } from '../../events.js'
import { isPriced } from '../../services/kita/index.js'
import { defaultAgent } from '../../services/kita/types.js'
import type { AgentId } from '../../services/kita/types.js'
import { pushQueue, readQueue, takeQueue, unshiftQueue } from './queue.js'
import { defaultProject, listProjects, projectDirectory } from './projects.js'
import { conflict } from '../../errors.js'
import { projectInstructions } from './instructions.js'
import { createSession, listSessions, readSession, sessionOf, setUserState, threadOf } from './sessions.js'
import type { QueuedMessage, Upload } from './types.js'
import { discardUploads, uploadFiles } from './uploads.js'
import { recordQuotaSample } from './usage.js'

// 答完了在等后台任务的 session：刚进入这个状态时发出排着的话
const waitingSessions = new Set<number>()

// 一轮开始、插话、答完、开始或结束等后台任务时通知页面重新读取列表；答完时发出排着的话
codeKita.onEvent((thread, event) => {
  const id = sessionOf(thread)
  if (id === undefined) {
    return
  }
  if (event.type === 'status') {
    const waiting = event.status?.type === 'waiting'
    if (waiting !== waitingSessions.has(id)) {
      if (waiting) {
        waitingSessions.add(id)
        // 刚答完、开始等后台任务：排着的话交给 agent，它接着答
        drainQueue(id)
      } else {
        waitingSessions.delete(id)
      }
      notifyChange({ type: 'session', id })
    }
  } else if (event.type === 'event' && event.event.data.type === 'input') {
    notifyChange({ type: 'session', id })
  } else if (event.type === 'event' && event.event.data.type === 'turn_end') {
    waitingSessions.delete(id)
    // 先记下额度的点，页面收到通知读到的用量才是新的
    if (isPriced(threadOf(id).summary().agent)) {
      recordQuotaSample()
    }
    notifyChange({ type: 'session', id })
    // 被停止、出错的一轮不接着发，排着的话留给用户决定
    if (!event.event.data.outcome) {
      drainQueue(id)
    }
  }
})

// interrupt：插话前先打断正在做的事；agent：新的 session 用哪个 agent，已有的 session 沿用它的；
// model、effort：开始新的一轮时用，插话时沿用这一轮的
export type MessageOptions = { project?: string; interrupt?: boolean; agent?: AgentId; model?: string; effort?: string }

// 用户发来一句话：没在回答时开始新的一轮；正在回答时交给 agent，它在下一次工具调用之间看到。
// 归档了的 session 又接着聊，就回到列表里。返回 session 编号；交不过去时返回 undefined
export async function sendMessage(sessionId: number | undefined, text: string, uploads: Upload[], options: MessageOptions): Promise<number | undefined> {
  let id = sessionId
  if (id === undefined) {
    const project = options.project ?? defaultProject
    const cwd = projectDirectory(project)
    const instructions = project === defaultProject ? codeInstructions : projectInstructions(listProjects().find((item) => item.id === project)!, cwd)
    id = createSession(codeKita.createSession({ agent: options.agent ?? defaultAgent, cwd, instructions }).id, project)
  } else {
    const project = readSession(id).project
    if (project !== defaultProject && threadOf(id).metadata().cwd !== projectDirectory(project)) {
      throw conflict('这个旧对话使用其他仓库的目录，请在当前项目中开启新对话')
    }
    setUserState(id, { archived: undefined })
  }
  const { interrupt, model, effort } = options
  return (await threadOf(id).send({ text, attachments: uploadFiles(uploads) }, { interrupt, model, effort })) ? id : undefined
}

// 排到这一轮答完之后再发；没在回答（包括答完了在等后台任务）时和直接发一样。返回 session 编号，交不过去时返回 undefined
export async function queueMessage(sessionId: number, text: string, uploads: Upload[], options: MessageOptions): Promise<number | undefined> {
  if (threadOf(sessionId).state() !== 'running') {
    return sendMessage(sessionId, text, uploads, options)
  }
  const { model, effort } = options
  pushQueue(sessionId, {
    time: new Date().toISOString(),
    text,
    ...(uploads.length > 0 && { attachments: uploads }),
    ...(model && { model }),
    ...(effort && { effort }),
  })
  notifyChange({ type: 'session', id: sessionId })
  return sessionId
}

// 撤回一条排队的消息，返回它的文字；已经发出去了时返回 undefined
export function unqueueMessage(sessionId: number, itemId: string): string | undefined {
  const message = takeQueue(sessionId, itemId)
  if (!message) {
    return undefined
  }
  discardUploads(message.attachments ?? [])
  notifyChange({ type: 'session', id: sessionId })
  return message.text
}

// 现在就发一条排队的消息（被停止或出错后留下的）
export async function sendQueued(sessionId: number, itemId: string): Promise<number | undefined> {
  const message = takeQueue(sessionId, itemId)
  return message && sendTaken(sessionId, message)
}

// 把排在最前面的一条发出去，后面的等它答完再发
function drainQueue(sessionId: number) {
  const message = takeQueue(sessionId)
  if (message) {
    void sendTaken(sessionId, message).catch((error: unknown) => console.error(error))
  }
}

// 发不出去就放回队列
async function sendTaken(sessionId: number, message: QueuedMessage): Promise<number | undefined> {
  const { text, attachments = [], model, effort } = message
  let sent: number | undefined
  try {
    sent = await sendMessage(sessionId, text, attachments, { model, effort })
  } finally {
    if (sent === undefined) {
      unshiftQueue(sessionId, message)
      notifyChange({ type: 'session', id: sessionId })
    }
  }
  return sent
}

export function stopSession(sessionId: number): boolean {
  return threadOf(sessionId).stop()
}

// 后端在一轮答完、排着的话还没发出时重启了
export function drainQueues() {
  for (const id of listSessions()) {
    const thread = threadOf(id)
    if (thread.state() === 'idle' && !thread.summary().outcome && readQueue(id).length > 0) {
      drainQueue(id)
    }
  }
}
