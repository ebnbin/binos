import type { Http, Queries, Sse, WebSockets } from '@binos/protocol'
import type { ExtractSchema, MergePath } from 'hono/types'
import type { JSONParsed } from 'hono/utils/types'
import type { api } from './api.js'
import type { browserApi } from './apps/browser/api.js'
import type { buildsApi } from './apps/builds/api.js'
import type { codeApi } from './apps/code/api.js'
import type { devicesApi } from './apps/devices/api.js'
import type { filesApi } from './apps/files/api.js'
import type { kitaAppApi } from './apps/kita/api.js'
import type { musicApi } from './apps/music/api.js'
import type { systemApi } from './apps/system/api.js'
import type { terminalApi } from './apps/terminal/api.js'
import type { claudeApi } from './services/kita/drivers/claude/api.js'
import type { codexApi } from './services/kita/drivers/codex/api.js'

// 客户端收发的数据结构登记在 protocol/src/index.ts。
// 这里在类型检查时核对 Http 和各个路由实际返回的 JSON：路由的响应变了而 Http 没跟着改，pnpm check 就报出是哪个路由。
// app 和 agent 的路由是运行时挂上去的，不在 api 的类型里，按挂载的位置逐个列出
type Mounted =
  | Routes<typeof api, ''>
  | Routes<typeof claudeApi, '/api/kita/claude'>
  | Routes<typeof codexApi, '/api/kita/codex'>
  | Routes<typeof browserApi, '/api/apps/browser'>
  | Routes<typeof buildsApi, '/api/apps/builds'>
  | Routes<typeof codeApi, '/api/apps/code'>
  | Routes<typeof devicesApi, '/api/apps/devices'>
  | Routes<typeof filesApi, '/api/apps/files'>
  | Routes<typeof kitaAppApi, '/api/apps/kita'>
  | Routes<typeof musicApi, '/api/apps/music'>
  | Routes<typeof systemApi, '/api/apps/system'>
  | Routes<typeof terminalApi, '/api/apps/terminal'>

// 音乐 API 的自述不是给客户端解析的
type Unchecked = 'GET /api/apps/music'

type Method<M> = M extends `$${infer Name}` ? Uppercase<Name> : never
type Routes<App, Prefix extends string, S = ExtractSchema<App>> = {
  [P in keyof S & string]: {
    [M in keyof S[P] & string]: S[P][M] extends infer E ? (E extends { outputFormat: 'json'; output: infer O } ? [`${Method<M>} ${MergePath<Prefix, P>}`, O] : never) : never
  }[keyof S[P] & string]
}[keyof S & string]
type Actual = { [K in Mounted[0]]: Extract<Mounted, [K, unknown]>[1] }
type Plain<T> = T extends readonly unknown[] ? Plain<T[number]>[] : T extends object ? { -readonly [K in keyof T]: Plain<T[K]> } : T
type Same<A, B> = (<T>() => T extends Plain<A> ? 1 : 2) extends <T>() => T extends Plain<B> ? 1 : 2 ? true : false
type Checked = Exclude<{ [K in keyof Http]: Http[K] extends { response: unknown } ? K : never }[keyof Http], Unchecked>
type Mismatch = { [K in Checked & keyof Actual]: Same<JSONParsed<Http[K]['response']>, Actual[K]> extends true ? never : K }[Checked & keyof Actual]
type Assert<T extends never> = T
// Queries 里的都要是登记了的路由
export type RoutesMatch = [Assert<Mismatch>, Assert<Exclude<keyof Actual, keyof Http>>, Assert<Exclude<Checked, keyof Actual>>, Assert<Exclude<keyof Queries, keyof Http | keyof Sse | keyof WebSockets>>]
