import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { ApiException, badRequest, conflict, notFound } from '../../errors.js'
import { notifyChange } from '../../events.js'
import { isPriced } from '../../services/kita/index.js'
import { agentIds } from '../../services/kita/types.js'
import type { AgentId } from '../../services/kita/types.js'
import { queueMessage, sendMessage, sendQueued, stopSession, unqueueMessage } from './messages.js'
import type { MessageOptions } from './messages.js'
import { pullRequests } from './pull-requests.js'
import { connectProject, createProject, listProjects, projectExists } from './projects.js'
import { parseRepository } from './repositories.js'
import { readQueue } from './queue.js'
import { listSessions, readSession, searchContent, searchSessions, sessionExists, sessionTitle, setUserState, threadOf } from './sessions.js'
import type { MessageBody, RepositoryBody, SessionEdit, SessionRef, SessionSummary, Upload } from './types.js'
import { parseUploads, saveUpload } from './uploads.js'
import { codeUsage, sessionUsage } from './usage.js'

const sessionParam = validator('param', (value: Record<string, string>) => {
  const id = Number(value.id)
  if (!sessionExists(id)) {
    throw notFound('对话不存在')
  }
  return { id }
})

// 排队的一条消息
const queueParam = validator('param', (value: Record<string, string>) => {
  const id = Number(value.id)
  if (!sessionExists(id)) {
    throw notFound('对话不存在')
  }
  return { id, item: value.item ?? '' }
})

const isAgent = (value: unknown): value is AgentId => agentIds.includes(value as AgentId)
// 模型和思考程度是否适用于这个 agent，开始一轮时再看
const isName = (value: unknown): value is string => typeof value === 'string' && /^[\w.-]{1,64}$/.test(value)

// attachments 的 file 是上传后拿到的文件名；有附件时可以不写字。
// interrupt：正在回答时先打断正在做的事；queue：正在回答时排到这一轮答完之后；agent：新的 session 用哪个 agent，不给是默认的；
// model、effort：开始新的一轮时用，不给就是 agent 的默认
const messageBody = validator('json', (value) => {
  const body = value as { [K in keyof MessageBody]?: unknown } | null
  const attachments = parseUploads(body?.attachments)
  if (
    (body?.project !== undefined && (typeof body.project !== 'string' || !projectExists(body.project))) ||
    typeof body?.text !== 'string' ||
    !attachments ||
    (!body.text.trim() && !attachments.length) ||
    (body.agent !== undefined && !isAgent(body.agent)) ||
    (body.model !== undefined && !isName(body.model)) ||
    (body.effort !== undefined && !isName(body.effort))
  ) {
    throw badRequest('消息无效：要有文字或附件，附件要先上传')
  }
  const message: { text: string; attachments: Upload[]; queue?: true } & MessageOptions = {
    ...(typeof body.project === 'string' && { project: body.project }),
    text: body.text,
    attachments,
    ...(body.queue === true && { queue: true as const }),
    interrupt: body.interrupt === true,
    ...(isAgent(body.agent) && { agent: body.agent }),
    ...(isName(body.model) && { model: body.model }),
    ...(isName(body.effort) && { effort: body.effort }),
  }
  return message
})

const repositoryBody = validator('json', (value) => {
  const body = value as { [K in keyof RepositoryBody]?: unknown } | null
  const name = typeof body?.name === 'string' ? body.name.replace(/\p{Cc}/gu, ' ').trim() : ''
  const repository = typeof body?.repository === 'string' ? parseRepository(body.repository) : undefined
  if (!name || name.length > 100 || !repository || (body?.create !== undefined && typeof body.create !== 'boolean')) {
    throw badRequest('请填写项目名称和 GitHub 仓库（owner/name）')
  }
  return { name, repository, create: body?.create === true }
})

const editBody = validator('json', (value) => {
  const body = value as { [K in keyof SessionEdit]?: unknown } | null
  const title = typeof body?.title === 'string' ? body.title.replace(/\p{Cc}/gu, ' ').trim().slice(0, 200) : undefined
  if (
    !body ||
    (body.title !== undefined && !title) ||
    (body.pinned !== undefined && typeof body.pinned !== 'boolean') ||
    (body.archived !== undefined && typeof body.archived !== 'boolean')
  ) {
    throw badRequest()
  }
  const edit: SessionEdit = {
    ...(title && { title }),
    ...(typeof body.pinned === 'boolean' && { pinned: body.pinned }),
    ...(typeof body.archived === 'boolean' && { archived: body.archived }),
  }
  return edit
})

// PR 的状态查到有变化时，通知页面重新读取列表
async function summary(id: number): Promise<SessionSummary> {
  const session = readSession(id)
  const thread = threadOf(id).summary()
  const prs = await pullRequests(session.prs, () => notifyChange({ type: 'session', id }))
  return {
    id,
    kitaSession: thread.id,
    project: session.project,
    title: sessionTitle(session),
    updatedAt: thread.updatedAt,
    running: thread.state === 'running',
    waiting: thread.state === 'waiting',
    unread: isUnread(id),
    ...(thread.outcome && { outcome: thread.outcome }),
    pinned: Boolean(session.pinned),
    archived: Boolean(session.archived),
    ...(thread.context && { context: thread.context }),
    agent: thread.agent,
    ...(thread.model && { model: thread.model }),
    ...(thread.effort && { effort: thread.effort }),
    turns: thread.turns,
    priced: isPriced(thread.agent),
    ...sessionUsage(id),
    prs,
    queue: readQueue(id),
  }
}

// 页面正在看、又没在回答时才算看过
function isUnread(id: number) {
  const { readAt } = readSession(id)
  const { state, repliedAt } = threadOf(id).summary()
  return state === 'idle' && Boolean(readAt && repliedAt && repliedAt > readAt)
}

// 消息没能交给 agent 时是 503 unavailable
function toResult(id: number | undefined): SessionRef {
  if (id === undefined) throw new ApiException(503, 'unavailable', '消息没能交给 agent，稍后再试')
  return { id, kitaSession: readSession(id).kitaSession }
}

export const codeApi = new Hono()
  .get('/projects', (c) => c.json({ projects: listProjects() }))
  .post('/projects', repositoryBody, async (c) => {
    const { name, repository, create } = c.req.valid('json')
    const project = await createProject(name, repository, create)
    notifyChange({ type: 'project' })
    return c.json({ project }, 201)
  })
  .post('/projects/:project/repository', repositoryBody, async (c) => {
    const { repository, create } = c.req.valid('json')
    const project = await connectProject(c.req.param('project'), repository, create)
    notifyChange({ type: 'project' })
    return c.json({ project }, 200)
  })
  .get('/search', (c) => c.json(searchContent(c.req.query('q') ?? '')))
  // q：只要标题、用户的话或回复的文字里含有它的。按最近有动静的排在前面
  .get('/sessions', async (c) => {
    const query = c.req.query('q')?.trim()
    const ids = listSessions()
    const matched = query ? searchSessions(ids, query) : undefined
    const sessions = (await Promise.all(ids.filter((id) => !matched || matched.has(id)).map(summary))).sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    )
    return c.json({ sessions })
  })
  // 这 7 天 binOS 大约用了周额度的多少，能折算花费的 agent 的一轮结束时会变（随会话的通知重新读取）
  .get('/usage', (c) => c.json({ usage: codeUsage() ?? null }))
  // 请求体就是文件本身，原来的文件名 URL 编码后放在 X-File-Name 里
  .post('/uploads', async (c) => {
    const body = c.req.raw.body
    if (!body || c.req.header('Content-Type') !== 'application/octet-stream') {
      throw new ApiException(415, 'unsupported-media-type', '请求体要是文件本身（application/octet-stream）')
    }
    let name = ''
    try {
      name = decodeURIComponent(c.req.header('X-File-Name') ?? '')
    } catch {
      // 文件名解不开就当没有
    }
    return c.json({ file: await saveUpload(body, name) }, 200)
  })
  .post('/sessions', messageBody, async (c) => {
    const { text, attachments, queue: _queue, ...options } = c.req.valid('json')
    return c.json(toResult(await sendMessage(undefined, text, attachments, { ...options, interrupt: false })), 200)
  })
  // 正在回答时交给 agent 或者排队，没在回答时开始新的一轮
  .post('/sessions/:id/messages', sessionParam, messageBody, async (c) => {
    const { text, attachments, queue, ...options } = c.req.valid('json')
    const id = c.req.valid('param').id
    return c.json(toResult(await (queue ? queueMessage : sendMessage)(id, text, attachments, options)), 200)
  })
  // 撤回排队的消息，返回它的文字放回输入框；已经发出去了时 404
  .post('/sessions/:id/queue/:item/withdraw', queueParam, (c) => {
    const { id, item } = c.req.valid('param')
    const text = unqueueMessage(id, item)
    if (text === undefined) throw new ApiException(410, 'gone', '这条消息已经发出去了')
    return c.json({ text }, 200)
  })
  // 现在就发一条排队的消息：只在没在回答时（被停止或出错后）
  .post('/sessions/:id/queue/:item/send', queueParam, async (c) => {
    const { id, item } = c.req.valid('param')
    if (threadOf(id).state() !== 'idle') {
      throw new ApiException(409, 'answering', '正在回答，答完后会自动发出')
    }
    return c.json(toResult(await sendQueued(id, item)), 200)
  })
  // 改名、置顶、归档是用户的整理，记在 session.json
  .post('/sessions/:id/edit', sessionParam, editBody, (c) => {
    const id = c.req.valid('param').id
    const { title, pinned, archived } = c.req.valid('json')
    if (title) {
      setUserState(id, { title })
    }
    if (pinned !== undefined) {
      setUserState(id, { pinned: pinned || undefined })
    }
    if (archived !== undefined) {
      setUserState(id, { archived: archived || undefined })
    }
    notifyChange({ type: 'session', id })
    return c.json({ ok: true }, 200)
  })
  // 页面正在显示这个 session：记为已读。原本有未读时才通知各个页面，否则页面收到通知重新读取，又会来标记，来回不停
  .post('/sessions/:id/read', sessionParam, (c) => {
    const id = c.req.valid('param').id
    const wasUnread = isUnread(id)
    setUserState(id, { readAt: new Date().toISOString() })
    if (wasUnread) {
      notifyChange({ type: 'session', id })
    }
    return c.json({ ok: true }, 200)
  })
  .post('/sessions/:id/stop', sessionParam, (c) => {
    if (!stopSession(c.req.valid('param').id)) {
      throw conflict('没在回答')
    }
    return c.json({ ok: true }, 200)
  })

export type CodeApi = typeof codeApi
