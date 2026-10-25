import { existsSync } from 'node:fs'
import { ApiException, badRequest, conflict, forbidden, notFound } from '../../errors.js'
import { serveFile } from '../../files.js'
import path from 'node:path'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { validator } from 'hono/validator'
import { connectedPreamble, keepAlive } from '../../sse.js'
import { agentAccounts, agentCatalogs } from './accounts.js'
import { drivers } from './drivers/index.js'
import { agentStatus } from './status.js'
import { filesDir } from './store.js'
import { activity, getKitaSession } from './sessions.js'
import { addMemory, addPhoto, listMemories, maxDescriptionLength, maxMemoryLength, photoPattern, photosDir, readProfile, removeMemory, removePhoto, revertMemory, setAvatar, setDescription, updateMemory } from './identity.js'
import { metadata } from './store.js'
import { clipEvent } from './journal.js'
import type { IdentityScope, KitaSessionEvent, Memory, MemoryChange, MemoryKind, MemorySource, NewMemory } from './types.js'

const threadParam = validator('param', (value: Record<string, string>) => {
  const id = value.id ?? ''
  if (!getKitaSession(id)) throw notFound('session 不存在')
  return { id }
})

const isKind = (value: unknown): value is MemoryKind => value === 'stated' || value === 'inferred'
const scopePattern = /^[a-z0-9-]{1,40}$/

// 谁在改记忆：带着 session 的是那个 session 里的 agent，只能动它的身份能读的记忆；没带的是页面上的用户
function memoryWriter(session: unknown): { source: MemorySource; scope?: IdentityScope } | undefined {
  if (session === undefined) return { source: { type: 'user' } }
  if (typeof session !== 'string' || !getKitaSession(session)) return undefined
  const { identity, owner } = metadata(session)
  return identity ? { source: { type: 'session', owner, session }, scope: identity } : undefined
}

const memoryText = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

// 请求体的形状就是页面要传的；谁在写、写到哪个范围在路由里定
const newMemoryBody = validator('json', (value) => {
  const body = (value ?? {}) as { [K in keyof NewMemory]?: unknown }
  const text = memoryText(body.text)
  if (
    !text ||
    text.length > maxMemoryLength ||
    (body.session !== undefined && typeof body.session !== 'string') ||
    (body.kind !== undefined && !isKind(body.kind)) ||
    (body.scope !== undefined && (typeof body.scope !== 'string' || !scopePattern.test(body.scope)))
  ) {
    throw badRequest('记忆无效')
  }
  const memory: NewMemory = {
    text,
    ...(typeof body.session === 'string' && { session: body.session }),
    ...(isKind(body.kind) && { kind: body.kind }),
    ...(typeof body.scope === 'string' && { scope: body.scope }),
  }
  return memory
})

const memoryChangeBody = validator('json', (value) => {
  const body = (value ?? {}) as { [K in keyof MemoryChange]?: unknown }
  const text = body.text === undefined ? undefined : memoryText(body.text)
  if (text === '' || (text && text.length > maxMemoryLength) || (body.session !== undefined && typeof body.session !== 'string') || (body.kind !== undefined && !isKind(body.kind))) {
    throw badRequest('记忆无效')
  }
  const change: MemoryChange = {
    ...(typeof body.session === 'string' && { session: body.session }),
    ...(text && { text }),
    ...(isKind(body.kind) && { kind: body.kind }),
  }
  return change
})

const memoryForbidden = () => forbidden('这个 session 不能改这条记忆')

// 要改的记忆和改它的是谁
function memoryChange(id: string, session: string | undefined): { memory: Memory; source: MemorySource } {
  const memory = listMemories().find((item) => item.id === id)
  if (!memory) throw notFound('记忆不存在')
  const writer = memoryWriter(session)
  if (!writer || (writer.scope && !writer.scope.read.includes(memory.scope))) throw memoryForbidden()
  return { memory, source: writer.source }
}

const photoParam = validator('param', (value: Record<string, string>) => {
  const file = value.file ?? ''
  if (!photoPattern.test(file) || !readProfile().photos.some((photo) => photo.file === file)) throw notFound('照片不存在')
  return { file }
})

// 页面用到的 agent 服务：系统 app 显示账号，app 里选 agent 和模型、显示 session 的内容。
// 建 session、说话由各个 app 在后端调用；各个 agent 自己的接口（比如在网页上登录）在 /<agent 的 id> 下
export const kitaApi = new Hono()
  // 各个 agent 最近报告的额度和登录的状况，页面收到 agent 通知时重新读取
  .get('/status', (c) => c.json(agentStatus()))
  // 各个 agent 的账号、登录凭证和用量
  .get('/accounts', async (c) => c.json({ accounts: await agentAccounts() }))
  // 各个 agent 能不能用、有哪些模型
  .get('/agents', async (c) => c.json({ agents: await agentCatalogs() }))
  .get('/sessions/:id', threadParam, (c) => {
    const session = getKitaSession(c.req.valid('param').id)!
    return c.json({ metadata: session.metadata(), summary: session.summary(), turns: session.turns(), items: session.items() })
  })
  // from：seq 大于它的事件；before：seq 小于它的至少 limit 条，从一轮的开头读起，读到开头时带上第一条 session 条目
  .get('/sessions/:id/events', threadParam, (c) => {
    const session = getKitaSession(c.req.valid('param').id)!
    const before = c.req.query('before')
    if (before !== undefined) {
      const end = Number(before) - 1, limit = Number(c.req.query('limit') ?? 0)
      if (!Number.isSafeInteger(end) || end < 0 || !Number.isSafeInteger(limit) || limit < 0) throw badRequest()
      return c.json({ events: session.pageEvents(session.windowStart(limit, end), end).map(clipEvent) })
    }
    const from = Number(c.req.query('from') ?? 0)
    if (!Number.isSafeInteger(from) || from < 0) throw badRequest()
    return c.json({ events: session.pageEvents(from).map(clipEvent) })
  })
  // seq 处的工具调用和它的结果，完整的，事件里省略过的在页面展开时读
  .get('/sessions/:id/calls/:seq', threadParam, (c) => {
    const call = getKitaSession(c.req.valid('param').id)!.call(Number(c.req.param('seq')))
    if (!call) throw notFound('这里没有工具调用')
    return c.json(call)
  })
  // SSE 的 id 是事件的 seq，断线重连时带上 Last-Event-ID（或 ?from=）从那之后接着补发。
  // 第一次连接用 tail 只要最后至少这么多条，从一轮的开头给出，更早的由页面按需用 /events 读
  .get('/sessions/:id/stream', threadParam, (c) => {
    const session = getKitaSession(c.req.valid('param').id)!
    const resume = c.req.header('Last-Event-ID') ?? c.req.query('from')
    const tail = resume === undefined ? Number(c.req.query('tail')) : NaN
    const from = resume === undefined ? session.windowStart(Number.isSafeInteger(tail) && tail > 0 ? tail : Infinity) : Number(resume) || 0
    return streamSSE(c, async (stream) => {
      const send = (event: KitaSessionEvent) => {
        const last = event.type === 'event' ? event.event.seq : event.type === 'events' || event.type === 'window' ? event.events.at(-1)?.seq : undefined
        void stream.writeSSE({ data: JSON.stringify(event.type === 'event' ? { ...event, event: clipEvent(event.event) } : event), id: last === undefined ? undefined : String(last) })
      }
      // 读取条目、补发、开始监听之间没有等待，不会漏掉或重复。补发的条目一次发完，页面一次显示出来
      await stream.write(connectedPreamble)
      const backlog = session.pageEvents(from).map(clipEvent)
      if (resume === undefined) send({ type: 'window', session: session.metadata(), events: backlog })
      else if (backlog.length) send({ type: 'events', events: backlog })
      send({ type: 'live', live: session.live() })
      stream.onAbort(session.subscribe(send))
      await keepAlive(stream)
    })
  })
  // 文件名由后端生成，内容不会变，可以长期缓存。name 是下载时用的文件名
  .get('/sessions/:id/files/:file', threadParam, (c) => {
    const file = c.req.param('file')
    const match = /^[\w-]+(?:\.(\w+))?$/.exec(file)
    const filePath = path.join(filesDir(c.req.valid('param').id), file)
    if (!match || !existsSync(filePath)) {
      throw notFound('文件不存在')
    }
    return serveFile(c, filePath, true)
  })

  // 各个 app 正在回答的 session
  .get('/activity', (c) => c.json({ activity: activity() }))
  // 喜多：用户写的描述和照片
  .get('/profile', (c) => c.json({ profile: readProfile() }))
  .put('/profile/description', validator('json', (value) => {
    const description = (value as { description?: unknown } | null)?.description
    if (typeof description !== 'string' || description.length > maxDescriptionLength) throw badRequest(`描述最多 ${maxDescriptionLength} 个字`)
    return { description }
  }), (c) => {
    setDescription(c.req.valid('json').description)
    return c.body(null, 204)
  })
  // 请求体就是照片本身，原来的文件名 URL 编码后放在 X-File-Name 里
  .post('/profile/photos', async (c) => {
    const body = c.req.raw.body
    if (!body || c.req.header('Content-Type') !== 'application/octet-stream') throw new ApiException(415, 'unsupported-media-type', '请求体要是照片本身（application/octet-stream）')
    let name = ''
    try {
      name = decodeURIComponent(c.req.header('X-File-Name') ?? '')
    } catch {
      // 文件名解不开就当没有，按格式不支持拒绝
    }
    return c.json({ file: await addPhoto(body, name) }, 201)
  })
  .get('/profile/photos/:file', photoParam, (c) => serveFile(c, path.join(photosDir, c.req.valid('param').file), true))
  .delete('/profile/photos/:file', photoParam, (c) => {
    removePhoto(c.req.valid('param').file)
    return c.body(null, 204)
  })
  // 用哪张照片作头像
  .put('/profile/avatar', validator('json', (value) => {
    const file = (value as { file?: unknown } | null)?.file
    if (typeof file !== 'string' || !readProfile().photos.some((photo) => photo.file === file)) throw notFound('照片不存在')
    return { file }
  }), (c) => {
    setAvatar(c.req.valid('json').file)
    return c.body(null, 204)
  })
  // 长期记忆
  .get('/memories', (c) => c.json({ memories: listMemories() }))
  // agent 记的写到它的身份的 write 范围
  .post('/memories', newMemoryBody, (c) => {
    const { session, text, kind = 'stated', scope } = c.req.valid('json')
    const writer = memoryWriter(session)
    if (!writer || (writer.scope && scope !== undefined)) throw forbidden('agent 只能记到它的身份能写的范围')
    return c.json({ memory: addMemory(text, kind, writer.scope?.write ?? scope ?? 'personal', writer.source) }, 201)
  })
  .patch('/memories/:id', memoryChangeBody, (c) => {
    const { session, ...change } = c.req.valid('json')
    const target = memoryChange(c.req.param('id'), session)
    return c.json({ memory: updateMemory(target.memory.id, change, target.source)! }, 200)
  })
  // session：agent 在哪个 session 里删的，页面上的用户不带
  .delete('/memories/:id', (c) => {
    removeMemory(memoryChange(c.req.param('id'), c.req.query('session')).memory.id)
    return c.body(null, 204)
  })
  // 恢复上一个版本，只在页面上
  .post('/memories/:id/revert', memoryChangeBody, (c) => {
    const target = memoryChange(c.req.param('id'), c.req.valid('json').session)
    if (target.source.type !== 'user') throw memoryForbidden()
    const memory = revertMemory(target.memory.id)
    if (!memory) throw conflict('没有更早的版本')
    return c.json({ memory }, 200)
  })

// 各个 agent 的接口，页面用 driver 各自导出的类型
for (const driver of Object.values(drivers)) {
  kitaApi.route(`/${driver.id}`, driver.api)
}

export type KitaApi = typeof kitaApi
