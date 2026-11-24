import type { Http, Queries, Sse, WebSockets } from './contract.ts'
import type { ApiError, AppRegistry, Apps } from './contract.ts'

type Route = keyof Http | keyof Sse | keyof WebSockets
type PathParams<Path extends string> = Path extends `${string}:${infer Name}/${infer Rest}` ? Name | PathParams<Rest> : Path extends `${string}:${infer Name}` ? Name : never
type Params<R extends Route> = PathParams<R extends `${string} ${infer Path}` ? Path : never>
type Body<R extends keyof Http> = Http[R] extends { request: infer Request } ? Request : undefined
type ResponseBody<R extends keyof Http> = Http[R] extends { response: infer Response } ? Response : never
// json() 是登记的响应体
export type ApiResponse<T> = Omit<Response, 'json'> & { json(): Promise<T> }

// 契约里没登记的部分不能传，登记了但全是可选的可以不传
type ParamsOption<R extends Route> = [Params<R>] extends [never] ? { params?: undefined } : { params: Record<Params<R>, string> }
type QueryOption<R extends Route> = R extends keyof Queries ? (Partial<Queries[R]> extends Queries[R] ? { query?: Queries[R] } : { query: Queries[R] }) : { query?: undefined }
// 请求体是 JSON 的接口用 json；请求体是文件本身的接口用 body，另外的请求头放在 headers
type BodyOption<R extends keyof Http> = Body<R> extends undefined ? { json?: undefined; body?: Blob; headers?: Record<string, string> } : { json: Body<R>; body?: undefined; headers?: undefined }
type UrlOptions<R extends Route> = ParamsOption<R> & QueryOption<R>
type RequestOptions<R extends keyof Http> = UrlOptions<R> & BodyOption<R> & { signal?: AbortSignal }
type Args<Options> = Partial<Options> extends Options ? [options?: Options] : [options: Options]

function url(route: string, params: Record<string, string> = {}, query: object = {}) {
  const result = new URL(route.slice(route.indexOf(' ') + 1).replace(/:(\w+)/g, (_, name: string) => encodeURIComponent(params[name])), window.location.origin)
  for (const [key, value] of Object.entries(query) as [string, string | undefined][]) {
    if (value !== undefined) result.searchParams.set(key, value)
  }
  return result
}

// 契约里登记的接口的网址：params 填进路径里 :name 的位置，query 里 undefined 的不带
export function apiUrl<R extends Route>(route: R, ...[options]: Args<UrlOptions<R>>): URL {
  return url(route, options?.params, options?.query)
}

// 契约里登记的 WebSocket 的网址，和页面一样用 wss 或 ws
export function socketUrl<R extends keyof WebSockets>(route: R, ...[options]: Args<UrlOptions<R>>): URL {
  const result = url(route, options?.params, options?.query)
  result.protocol = result.protocol === 'https:' ? 'wss:' : 'ws:'
  return result
}

// 按契约请求一个接口，成功时 json() 是登记的响应体。写操作都带上 Content-Type，后端以此拒绝跨站请求
export function request<R extends keyof Http>(route: R, ...[options]: Args<RequestOptions<R>>): Promise<ApiResponse<ResponseBody<R>>> {
  const method = route.slice(0, route.indexOf(' '))
  const init: RequestInit = { method, signal: options?.signal }
  if (options?.body) {
    init.headers = { 'Content-Type': 'application/octet-stream', ...options.headers }
    init.body = options.body
  } else if (method !== 'GET') {
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

// 成功时读出 JSON 响应体，不成功时抛出带着原因的 Error
export async function readJson<T>(res: ApiResponse<T>, fallback: string): Promise<T> {
  if (!res.ok) throw new Error(await errorMessage(res, fallback))
  return res.json()
}

// 不成功时抛出带着原因的 Error
export async function ensureOk(res: Response | undefined, fallback: string): Promise<Response> {
  if (!res?.ok) throw new Error(await errorMessage(res, fallback))
  return res
}

// 正在提供的页面的版本（上线时写下的 version.json，开发时没有）和后端的协议标识；读不到的是 undefined
export async function readVersions(): Promise<{ web?: string; protocol?: string }> {
  const [web, health] = await Promise.all([
    fetch('/version.json', { cache: 'no-store' }).then((res) => (res.ok ? (res.json() as Promise<{ version?: string }>) : undefined)).catch(() => undefined),
    request('GET /api/health').then((res) => (res.ok ? res.json() : undefined)).catch(() => undefined),
  ])
  return { web: web?.version, protocol: health?.protocol }
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
