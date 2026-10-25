import type { CodeApi } from '@binos/server/apps/code/api'
import type { Upload } from '@binos/server/apps/code/types'
import type { AgentId } from '@binos/server/services/kita/types'
import { hc } from 'hono/client'
import { errorMessage } from '../../api.ts'

const client = hc<CodeApi>(`${window.location.origin}/api/apps/code`)
const sessions = client.sessions

// query：只要标题或对话内容里含有它的
export async function listSessions(query?: string) {
  const res = await sessions.$get({ query: query ? { q: query } : {} })
  if (!res.ok) {
    throw new Error(`读取 session 列表失败（${res.status}）`)
  }
  return (await res.json()).sessions
}

// 一个对话的概况；不存在了（被删掉）时返回 undefined，读不到时抛出
export async function readSession(id: number) {
  const res = await sessions[':id'].$get({ param: { id: String(id) } })
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
    (sessionId === null ? sessions.$post({ json }) : sessions[':id'].messages.$post({ param: { id: String(sessionId) }, json })).catch(() => undefined)
  let res = await post()
  for (const delay of retryDelays) {
    // 类型里只有成功的状态码，失败的由 ApiException 给出
    const status: number | undefined = res?.status
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
  const res = await client.usage.$get().catch(() => undefined)
  return res?.ok ? ((await res.json()).usage ?? undefined) : undefined
}

// 和后端一致
export const maxUploadBytes = 50 * 1024 * 1024

export async function uploadFile(file: File): Promise<Upload | { error: string }> {
  const res = await fetch(client.uploads.$url(), {
    method: 'POST',
    body: file,
    headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) },
  }).catch(() => undefined)
  if (res?.ok) {
    const { file: name } = (await res.json()) as { file: string }
    return { file: name, name: file.name }
  }
  return { error: await errorMessage(res, `上传 ${file.name} 失败`) }
}

// 写操作都要带上 JSON 的 Content-Type，后端以此拒绝跨站请求
const jsonHeaders = { headers: { 'Content-Type': 'application/json' } }

// 撤回排队的消息，拿回它的文字；已经发出去了时是 undefined
export async function withdrawQueued(sessionId: number, item: string): Promise<string | undefined> {
  const res = await sessions[':id'].queue[':item'].$delete({ param: { id: String(sessionId), item } }).catch(() => undefined)
  return res?.ok ? (await res.json()).text : undefined
}

export async function sendQueued(sessionId: number, item: string) {
  const res = await sessions[':id'].queue[':item'].send.$post({ param: { id: String(sessionId), item } }, jsonHeaders).catch(() => undefined)
  return res?.ok ?? false
}

export async function stopSession(sessionId: number) {
  await sessions[':id'].stop.$post({ param: { id: String(sessionId) } }, jsonHeaders).catch(() => undefined)
}

export async function editSession(sessionId: number, edit: { title?: string; pinned?: boolean; archived?: boolean }) {
  const res = await sessions[':id'].$patch({ param: { id: String(sessionId) }, json: edit }).catch(() => undefined)
  return res?.ok ?? false
}

export async function markRead(sessionId: number) {
  await sessions[':id'].read.$post({ param: { id: String(sessionId) } }, jsonHeaders).catch(() => undefined)
}

export async function searchContent(query: string) {
  const res = await client.search.$get({ query: { q: query } })
  if (!res.ok) throw new Error('搜索失败')
  return res.json()
}

export async function listProjects() {
  const res = await client.projects.$get()
  if (!res.ok) throw new Error('读取项目失败')
  return (await res.json()).projects
}

export async function createProject(name: string, repository: string, create: boolean, projectId?: string) {
  const json = { name, repository, create }
  const res = await (projectId
    ? client.projects[':project'].repository.$put({ param: { project: projectId }, json })
    : client.projects.$post({ json })
  ).catch(() => undefined)
  if (!res?.ok) throw new Error(await errorMessage(res, '项目没能建好'))
  return (await res.json()).project
}
