import type { Upload } from '../../contract.ts'
import type { AgentId } from '../../contract.ts'
import { errorMessage, request } from '../../api.ts'

// query：只要标题或对话内容里含有它的
export async function listSessions(query?: string) {
  const res = await request('GET /api/apps/code/sessions', { query: { q: query || undefined } })
  if (!res.ok) {
    throw new Error(`读取 session 列表失败（${res.status}）`)
  }
  return (await res.json()).sessions
}

// 一个对话的概况；不存在了（被删掉）时返回 undefined，读不到时抛出
export async function readSession(id: number) {
  const res = await request('GET /api/apps/code/sessions/:id', { params: { id: String(id) } })
  if (res.status === 404) return undefined
  if (!res.ok) throw new Error(`读取 session 失败（${res.status}）`)
  return res.json()
}

// interrupt：正在回答时先打断正在做的事；queue：正在回答时排到这一轮答完之后；
// agent：新对话用哪个 agent；model、effort：开始新的一轮时用，不给就是默认
export type SendOptions = { project?: string; interrupt?: boolean; queue?: true; agent?: AgentId; model?: string; effort?: string }

// 没收到回应或者网关出错时，请求可能已经到了：隔一会儿带着同一个 requestId 重试，后端不会再发一遍
const retryDelays = [1000, 2000, 4000]

// 正在回答时交给 agent 或者排队，没在回答时开始新的一轮
export async function sendMessage(
  sessionId: number | null,
  text: string,
  attachments: Upload[],
  options: SendOptions,
): Promise<{ id: number; kitaSession: string } | { error: string }> {
  const json = { requestId: crypto.randomUUID(), text, attachments, ...options }
  const post = () =>
    (sessionId === null ? request('POST /api/apps/code/sessions', { json }) : request('POST /api/apps/code/sessions/:id/messages', { params: { id: String(sessionId) }, json })).catch(() => undefined)
  let res = await post()
  for (const delay of retryDelays) {
    const status = res?.status
    if (status !== undefined && (status < 500 || status === 503)) break
    await new Promise((resolve) => setTimeout(resolve, delay))
    res = await post()
  }
  if (res?.ok) {
    return await res.json()
  }
  return { error: await errorMessage(res, '发送失败') }
}

// 这 7 天 binOS 大约用了周额度的多少；估不出来时没有
export async function codeUsage() {
  const res = await request('GET /api/apps/code/usage').catch(() => undefined)
  return res?.ok ? ((await res.json()).usage ?? undefined) : undefined
}

// 契约里登记的上限
export const maxUploadBytes = 50 * 1024 * 1024

export async function uploadFile(file: File): Promise<Upload | { error: string }> {
  const res = await request('POST /api/apps/code/uploads', { body: file, headers: { 'X-File-Name': encodeURIComponent(file.name) } }).catch(() => undefined)
  if (res?.ok) {
    const { file: name } = await res.json()
    return { file: name, name: file.name }
  }
  return { error: await errorMessage(res, `上传 ${file.name} 失败`) }
}

// 撤回排队的消息，拿回它的文字；已经发出去了时是 undefined
export async function withdrawQueued(sessionId: number, item: string): Promise<string | undefined> {
  const res = await request('DELETE /api/apps/code/sessions/:id/queue/:item', { params: { id: String(sessionId), item } }).catch(() => undefined)
  return res?.ok ? (await res.json()).text : undefined
}

export async function sendQueued(sessionId: number, item: string) {
  const res = await request('POST /api/apps/code/sessions/:id/queue/:item/send', { params: { id: String(sessionId), item } }).catch(() => undefined)
  return res?.ok ?? false
}

export async function stopSession(sessionId: number) {
  await request('POST /api/apps/code/sessions/:id/stop', { params: { id: String(sessionId) } }).catch(() => undefined)
}

export async function editSession(sessionId: number, edit: { title?: string; pinned?: boolean; archived?: boolean }) {
  const res = await request('PATCH /api/apps/code/sessions/:id', { params: { id: String(sessionId) }, json: edit }).catch(() => undefined)
  return res?.ok ?? false
}

export async function markRead(sessionId: number) {
  await request('POST /api/apps/code/sessions/:id/read', { params: { id: String(sessionId) } }).catch(() => undefined)
}

export async function searchContent(query: string) {
  const res = await request('GET /api/apps/code/search', { query: { q: query } })
  if (!res.ok) throw new Error('搜索失败')
  return res.json()
}

export async function listProjects() {
  const res = await request('GET /api/apps/code/projects')
  if (!res.ok) throw new Error('读取项目失败')
  return (await res.json()).projects
}

export async function createProject(name: string, repository: string, create: boolean, projectId?: string) {
  const json = { name, repository, create }
  const res = await (projectId
    ? request('PUT /api/apps/code/projects/:project/repository', { params: { project: projectId }, json })
    : request('POST /api/apps/code/projects', { json })
  ).catch(() => undefined)
  if (!res?.ok) throw new Error(await errorMessage(res, '项目没能建好'))
  return (await res.json()).project
}
