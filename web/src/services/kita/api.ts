import type { PageEvent } from '@binos/protocol/services/kita'
import { apiUrl, errorMessage, request } from '../../api.ts'

// 各个 agent 最近报告的额度和登录的状况；读不到时返回 undefined
export async function agentStatus() {
  const res = await request('GET /api/kita/status').catch(() => undefined)
  return res?.ok ? await res.json() : undefined
}

// 各个 agent 的账号、登录凭证和用量；读不到时返回 undefined
export async function agentAccounts() {
  const res = await request('GET /api/kita/accounts').catch(() => undefined)
  return res?.ok ? (await res.json()).accounts : undefined
}

// 各个 agent 能不能用、有哪些模型；读不到时返回空列表
export async function agentCatalogs() {
  const res = await request('GET /api/kita/agents').catch(() => undefined)
  return res?.ok ? (await res.json()).agents : []
}

// thread 的内容：seq 在 from 之后的事件，以及临时内容的变化；from 为 undefined 时先给出最后至少 tail 条，从一轮的开头起
export function sessionStreamUrl(thread: string, from: number | undefined, tail: number) {
  return apiUrl('GET /api/kita/sessions/:id/stream', { params: { id: thread }, query: { [from === undefined ? 'tail' : 'from']: String(from ?? tail) } }).href
}

// seq 在 before 之前的至少 limit 条事件，从一轮的开头读起；读不到时返回 undefined
export async function readOlderEvents(thread: string, before: number, limit: number): Promise<PageEvent[] | undefined> {
  const res = await request('GET /api/kita/sessions/:id/events', { params: { id: thread }, query: { before: String(before), limit: String(limit) } }).catch(() => undefined)
  return res?.ok ? (await res.json()).events : undefined
}

// 第 seq 条事件的工具调用和它的结果，完整的；读不到时返回 undefined
export async function readCall(thread: string, seq: number) {
  const res = await request('GET /api/kita/sessions/:id/calls/:seq', { params: { id: thread, seq: String(seq) } }).catch(() => undefined)
  return res?.ok ? await res.json() : undefined
}

// name：下载时用的文件名
export function sessionFileUrl(thread: string, file: string, name?: string) {
  const url = apiUrl('GET /api/kita/sessions/:id/files/:file', { params: { id: thread, file }, query: { name: name || undefined } })
  return url.pathname + url.search
}

// 各个 app 正在回答的 session；读不到时返回 undefined
export async function kitaActivity() {
  const res = await request('GET /api/kita/activity').catch(() => undefined)
  return res?.ok ? (await res.json()).activity : undefined
}

export async function readProfile() {
  const res = await request('GET /api/kita/profile')
  if (!res.ok) throw new Error('读取喜多的资料失败')
  return (await res.json()).profile
}

export async function saveDescription(description: string) {
  const res = await request('PUT /api/kita/profile/description', { json: { description } }).catch(() => undefined)
  return res?.ok ?? false
}

export const photoUrl = (file: string) => apiUrl('GET /api/kita/profile/photos/:file', { params: { file } }).pathname

export async function uploadPhoto(file: File): Promise<string | undefined> {
  const res = await fetch(apiUrl('POST /api/kita/profile/photos'), {
    method: 'POST',
    body: file,
    headers: { 'Content-Type': 'application/octet-stream' },
  }).catch(() => undefined)
  if (res?.ok) return undefined
  return errorMessage(res, `上传 ${file.name} 失败`)
}

export async function removePhoto(file: string) {
  await request('DELETE /api/kita/profile/photos/:file', { params: { file } }).catch(() => undefined)
}

export async function setAvatar(file: string) {
  await request('PUT /api/kita/profile/avatar', { json: { file } }).catch(() => undefined)
}

export async function listMemories() {
  const res = await request('GET /api/kita/memories')
  if (!res.ok) throw new Error('读取记忆失败')
  return (await res.json()).memories
}

export async function addMemory(text: string) {
  const res = await request('POST /api/kita/memories', { json: { text } }).catch(() => undefined)
  return res?.ok ?? false
}

export async function updateMemory(id: string, change: { text?: string; kind?: 'stated' | 'inferred' }) {
  const res = await request('PATCH /api/kita/memories/:id', { params: { id }, json: change }).catch(() => undefined)
  return res?.ok ?? false
}

export async function removeMemory(id: string) {
  await request('DELETE /api/kita/memories/:id', { params: { id } }).catch(() => undefined)
}

export async function revertMemory(id: string) {
  await request('POST /api/kita/memories/:id/revert', { params: { id }, json: {} }).catch(() => undefined)
}
