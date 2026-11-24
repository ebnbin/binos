import type { Http, Sse, WebSockets } from '@binos/protocol'
import type { ApiError, AppRegistry, Apps } from '@binos/protocol/core'

type Route = keyof Http | keyof Sse | keyof WebSockets
type PathParams<Path extends string> = Path extends `${string}:${infer Name}/${infer Rest}` ? Name | PathParams<Rest> : Path extends `${string}:${infer Name}` ? Name : never
type Params<R extends Route> = PathParams<R extends `${string} ${infer Path}` ? Path : never>
type Body<R extends keyof Http> = Http[R] extends { request: infer Request } ? Request : undefined
type ResponseBody<R extends keyof Http> = Http[R] extends { response: infer Response } ? Response : never

type Query = Record<string, string | undefined>
type UrlOptions<R extends Route> = ([Params<R>] extends [never] ? { params?: undefined } : { params: Record<Params<R>, string> }) & { query?: Query }
type RequestOptions<R extends keyof Http> = UrlOptions<R> & (Body<R> extends undefined ? { json?: undefined } : { json: Body<R> }) & { signal?: AbortSignal }
// 没有路径参数也没有请求体时可以不传
type Optional<R extends keyof Http, Options> = [Params<R>] extends [never] ? (Body<R> extends undefined ? [options?: Options] : [options: Options]) : [options: Options]

function url(route: string, params: Record<string, string> = {}, query: Query = {}) {
  const result = new URL(route.slice(route.indexOf(' ') + 1).replace(/:(\w+)/g, (_, name: string) => encodeURIComponent(params[name])), window.location.origin)
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) result.searchParams.set(key, value)
  }
  return result
}

// 契约里登记的接口的网址：params 填进路径里 :name 的位置，query 里 undefined 的不带
export function apiUrl<R extends Route>(route: R, ...[options]: [Params<R>] extends [never] ? [options?: UrlOptions<R>] : [options: UrlOptions<R>]): URL {
  return url(route, options?.params, options?.query)
}

// 按契约请求一个接口，成功时 json() 是登记的响应体。写操作都带上 JSON 的 Content-Type，后端以此拒绝跨站请求
export function request<R extends keyof Http>(route: R, ...[options]: Optional<R, RequestOptions<R>>): Promise<Omit<Response, 'json'> & { json(): Promise<ResponseBody<R>> }> {
  const method = route.slice(0, route.indexOf(' '))
  const init: RequestInit = { method, signal: options?.signal }
  if (method !== 'GET') {
    init.headers = { 'Content-Type': 'application/json' }
    if (options?.json !== undefined) init.body = JSON.stringify(options.json)
  }
  return fetch(url(route, options?.params, options?.query), init)
}

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
  const res = await request('GET /api/health').catch(() => undefined)
  return res?.ok ? (await res.json()).version : undefined
}

export function eventsUrl() {
  return apiUrl('GET /api/events').href
}

// 全部 app；读不到时返回 undefined
export async function readApps(): Promise<Apps | undefined> {
  const res = await request('GET /api/apps').catch(() => undefined)
  return res?.ok ? await res.json() : undefined
}

// 返回是否写入成功
export async function writeRegistry(registry: AppRegistry): Promise<boolean> {
  const res = await request('PUT /api/apps', { json: registry }).catch(() => undefined)
  return res?.ok ?? false
}
