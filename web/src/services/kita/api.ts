import type { KitaApi } from '@binos/server/services/kita/api'
import type { Entry, KitaSessionEvent } from '@binos/server/services/kita/types'
import { hc } from 'hono/client'
import { errorMessage } from '../../api.ts'

export type SessionEvent = Extract<KitaSessionEvent, { type: 'event' }>['event']

const client = hc<KitaApi>(`${window.location.origin}/api/kita`)

// 各个 agent 最近报告的额度和登录的状况；读不到时返回 undefined
export async function agentStatus() {
  const res = await client.status.$get().catch(() => undefined)
  return res?.ok ? await res.json() : undefined
}

// 各个 agent 的账号、登录凭证和用量；读不到时返回 undefined
export async function agentAccounts() {
  const res = await client.accounts.$get().catch(() => undefined)
  return res?.ok ? (await res.json()).accounts : undefined
}

// 各个 agent 能不能用、有哪些模型；读不到时返回空列表
export async function agentCatalogs() {
  const res = await client.agents.$get().catch(() => undefined)
  return res?.ok ? (await res.json()).agents : []
}

// thread 的内容：from 之后的条目，以及临时内容的变化；from 为 undefined 时只要最后至少 tail 条，从一轮的开头补发
export function sessionStreamUrl(thread: string, from: number | undefined, tail: number) {
  const url = client.sessions[':id'].stream.$url({ param: { id: thread } })
  url.searchParams.set(from === undefined ? 'tail' : 'from', String(from ?? tail))
  return url.href
}

// before 之前至少 limit 条事件，从一轮的开头读起；读不到时返回 undefined
export async function readOlderEvents(thread: string, before: number, limit: number): Promise<SessionEvent[] | undefined> {
  const url = client.sessions[':id'].events.$url({ param: { id: thread } })
  url.searchParams.set('before', String(before))
  url.searchParams.set('limit', String(limit))
  const res = await fetch(url).catch(() => undefined)
  return res?.ok ? ((await res.json()) as { events: SessionEvent[] }).events : undefined
}

// index 处的工具调用和它的结果，完整的；读不到时返回 undefined
export async function readCall(thread: string, index: number) {
  const url = client.sessions[':id'].calls[':index'].$url({ param: { id: thread, index: String(index) } })
  const res = await fetch(url).catch(() => undefined)
  return res?.ok ? ((await res.json()) as { call: Entry; result?: Entry }) : undefined
}

// name：下载时用的文件名
export function sessionFileUrl(thread: string, file: string, name?: string) {
  const url = client.sessions[':id'].files[':file'].$url({ param: { id: thread, file } })
  if (name) {
    url.searchParams.set('name', name)
  }
  return url.pathname + url.search
}

// 各个 app 正在回答的 session；读不到时返回 undefined
export async function kitaActivity() {
  const res = await client.activity.$get().catch(() => undefined)
  return res?.ok ? (await res.json()).activity : undefined
}

export async function readProfile() {
  const res = await client.profile.$get()
  if (!res.ok) throw new Error('读取喜多的资料失败')
  return (await res.json()).profile
}

export async function saveDescription(description: string) {
  const res = await client.profile.description.$put({ json: { description } }).catch(() => undefined)
  return res?.ok ?? false
}

export const photoUrl = (file: string) => client.profile.photos[':file'].$url({ param: { file } }).pathname

export async function uploadPhoto(file: File): Promise<string | undefined> {
  const res = await fetch(client.profile.photos.$url(), {
    method: 'POST',
    body: file,
    headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) },
  }).catch(() => undefined)
  if (res?.ok) return undefined
  return errorMessage(res, `上传 ${file.name} 失败`)
}

export async function removePhoto(file: string) {
  await client.profile.photos[':file'].$delete({ param: { file } }).catch(() => undefined)
}

export async function setAvatar(file: string) {
  await client.profile.avatar.$put({ json: { file } }).catch(() => undefined)
}

export async function listMemories() {
  const res = await client.memories.$get()
  if (!res.ok) throw new Error('读取记忆失败')
  return (await res.json()).memories
}

export async function addMemory(text: string) {
  const res = await client.memories.$post({ json: { text } }).catch(() => undefined)
  return res?.ok ?? false
}

export async function updateMemory(id: string, change: { text?: string; kind?: 'stated' | 'inferred' }) {
  const res = await client.memories[':id'].$patch({ param: { id }, json: change }).catch(() => undefined)
  return res?.ok ?? false
}

export async function removeMemory(id: string) {
  await client.memories[':id'].$delete({ param: { id } }).catch(() => undefined)
}

export async function revertMemory(id: string) {
  await client.memories[':id'].revert.$post({ param: { id }, json: {} }).catch(() => undefined)
}
