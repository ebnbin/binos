import type { AppType } from '@binos/server/api'
import type { ApiError } from '@binos/server/errors'
import type { AppRegistry } from '@binos/server/types'
import { hc } from 'hono/client'

const client = hc<AppType>(window.location.origin)

// 后端出错时给用户看的原因；读不到时（网络错误、不是后端的响应）用 fallback
export async function errorMessage(res: Response | undefined, fallback: string): Promise<string> {
  const body = (await res?.json().catch(() => undefined)) as Partial<ApiError> | undefined
  return body?.error?.message ?? (res ? `${fallback}（${res.status}）` : `${fallback}（网络错误）`)
}

// 不成功时抛出带着原因的 Error
export async function ensureOk(res: Response | undefined, fallback: string): Promise<Response> {
  if (!res?.ok) throw new Error(await errorMessage(res, fallback))
  return res
}

export async function getVersion(): Promise<string | undefined> {
  const res = await client.api.health.$get().catch(() => undefined)
  return res?.ok ? (await res.json()).version : undefined
}

export function eventsUrl() {
  return client.api.events.$url().href
}

// 读不到时返回 undefined
export async function readRegistry(): Promise<AppRegistry | undefined> {
  const res = await client.api.apps.$get().catch(() => undefined)
  return res?.ok ? await res.json() : undefined
}

// 返回是否写入成功
export async function writeRegistry(registry: AppRegistry): Promise<boolean> {
  const res = await client.api.apps.$put({ json: registry }).catch(() => undefined)
  return res?.ok ?? false
}
