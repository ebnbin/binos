import type { ExtractSchema, MergePath } from 'hono/types'
import type { JSONParsed } from 'hono/utils/types'
import type { api } from './api.js'
import type { browserApi } from './apps/browser/api.js'
import type { BrowserClientMessage, BrowserServerMessage } from './apps/browser/protocol.js'
import type { buildsApi } from './apps/builds/api.js'
import type { BuildRequest, BuildsSnapshot, InstallLink } from './apps/builds/types.js'
import type { codeApi } from './apps/code/api.js'
import type { CodeUsage, MessageBody, Project, RepositoryBody, SearchResults, SessionEdit, SessionRef, SessionSummary } from './apps/code/types.js'
import type { devicesApi, DevicesSnapshot } from './apps/devices/api.js'
import type { DeviceScreenshot, LeaseResult, Request as DeviceRequest } from './apps/devices/types.js'
import type { filesApi } from './apps/files/api.js'
import type { Directory, FileOperation } from './apps/files/types.js'
import type { kitaAppApi } from './apps/kita/api.js'
import type { Conversation, ConversationMessage } from './apps/kita/types.js'
import type { musicApi } from './apps/music/api.js'
import type { CatalogPage, CommandResult, Lyrics, MusicApiError, PlaybackSource, PlayerCommandRequest, PlayerMessage, PlayerReport, PlayerSnapshot, ProviderInfo, QueueMutation, QueueSnapshot } from './apps/music/types.js'
import type { systemApi } from './apps/system/api.js'
import type { MonitorStatus } from './apps/system/types.js'
import type { terminalApi } from './apps/terminal/api.js'
import type { TerminalClientMessage, TerminalServerMessage, TerminalStreamMessage } from './apps/terminal/connection.js'
import type { TerminalSession } from './apps/terminal/sessions.js'
import type { FileInfo } from './files.js'
import type { claudeApi } from './services/kita/drivers/claude/api.js'
import type { ClaudeLoginKind, ClaudeLoginStart } from './services/kita/drivers/claude/login.js'
import type { codexApi } from './services/kita/drivers/codex/api.js'
import type { CodexLoginStart, CodexLoginStatus } from './services/kita/drivers/codex/login.js'
import type { Item, PageEvent, SessionMetadata, Turn } from './services/kita/journal.js'
import type { CallDetail } from './services/kita/store.js'
import type { Activity, AgentAccount, AgentCatalog, AgentStatus, KitaSessionEvent, KitaSessionSummary, Memory, MemoryChange, NewMemory, Profile } from './services/kita/types.js'
import type { AppRegistry, ChangeEvent, Health } from './types.js'

// 客户端收发的全部 JSON：pnpm protocol 由它生成 server/protocol.schema.json，schema 的标识见 protocol-id.ts。
// http 的 request 是 JSON 请求体，response 是各种状态码下所有 JSON 响应体的并集；
// 请求体或响应体是文件本身、纯文字的不在这里。errors 是这个前缀下的路由出错时统一返回的
export type Protocol = {
  http: Http
  errors: Errors
  sse: Sse
  websocket: WebSockets
}

type Ok = { ok: true }
type Done = { ok: boolean }
type Failure = { error: string }

export type Http = {
  'GET /api/health': { response: Health }
  'GET /api/apps': { response: AppRegistry }
  'PUT /api/apps': { request: AppRegistry; response: Ok }

  'GET /api/kita/status': { response: AgentStatus }
  'GET /api/kita/accounts': { response: { accounts: AgentAccount[] } }
  'GET /api/kita/agents': { response: { agents: AgentCatalog[] } }
  'GET /api/kita/sessions/:id': { response: { metadata: SessionMetadata; summary: KitaSessionSummary; turns: Turn[]; items: Item[] } }
  // 给出 before 时是它之前至少 limit 条，否则是 from 之后的
  'GET /api/kita/sessions/:id/events': { response: { events: PageEvent[] } }
  'GET /api/kita/sessions/:id/calls/:index': { response: CallDetail }
  // ?info=1 时
  'GET /api/kita/sessions/:id/files/:file': { response: FileInfo }
  'GET /api/kita/activity': { response: { activity: Activity[] } }
  'GET /api/kita/profile': { response: { profile: Profile } }
  'POST /api/kita/profile/description': { request: { description: string }; response: Ok }
  'POST /api/kita/profile/photos': { response: { file: string } | Failure }
  // ?info=1 时
  'GET /api/kita/profile/photos/:file': { response: FileInfo }
  'POST /api/kita/profile/photos/:file/delete': { response: Done }
  'POST /api/kita/profile/photos/:file/avatar': { response: Done }
  'GET /api/kita/memories': { response: { memories: Memory[] } }
  'POST /api/kita/memories': { request: NewMemory; response: { memory: Memory } }
  'POST /api/kita/memories/:id': { request: MemoryChange; response: { memory: Memory } }
  'POST /api/kita/memories/:id/delete': { request: Pick<MemoryChange, 'session'>; response: Done }
  'POST /api/kita/memories/:id/revert': { request: Pick<MemoryChange, 'session'>; response: { memory: Memory } }
  'POST /api/kita/claude/login': { request: { kind: ClaudeLoginKind }; response: ClaudeLoginStart | Failure }
  'POST /api/kita/claude/login/:id': { request: { code: string }; response: Ok | Failure }
  'POST /api/kita/claude/login/:id/cancel': { response: Ok }
  'POST /api/kita/codex/login': { response: CodexLoginStart | Failure }
  'GET /api/kita/codex/login/:id': { response: CodexLoginStatus }
  'POST /api/kita/codex/login/:id/cancel': { response: Ok }

  'GET /api/apps/builds': { response: BuildsSnapshot }
  'POST /api/apps/builds': { request: Exclude<BuildRequest, { action: 'stop' | 'handoff' }>; response: BuildsSnapshot | Failure }
  'POST /api/apps/builds/:id/install': { response: InstallLink }

  'GET /api/apps/code/projects': { response: { projects: Project[] } }
  'POST /api/apps/code/projects': { request: RepositoryBody; response: { project: Project } | Failure }
  'POST /api/apps/code/projects/:project/repository': { request: RepositoryBody; response: { project: Project } | Failure }
  'GET /api/apps/code/search': { response: SearchResults }
  'GET /api/apps/code/sessions': { response: { sessions: SessionSummary[] } }
  'GET /api/apps/code/usage': { response: { usage: CodeUsage | null } }
  'POST /api/apps/code/uploads': { response: { file: string } }
  'POST /api/apps/code/sessions': { request: MessageBody; response: SessionRef | { error: 'unavailable' } | Failure }
  'POST /api/apps/code/sessions/:id/messages': { request: MessageBody; response: SessionRef | { error: 'unavailable' } | Failure }
  'POST /api/apps/code/sessions/:id/queue/:item/withdraw': { response: { text: string } | { error: 'gone' } }
  'POST /api/apps/code/sessions/:id/queue/:item/send': { response: SessionRef | { error: 'unavailable' } | { error: 'answering' } }
  'POST /api/apps/code/sessions/:id/edit': { request: SessionEdit; response: Ok }
  'POST /api/apps/code/sessions/:id/read': { response: Ok }
  'POST /api/apps/code/sessions/:id/stop': { response: Ok }

  'GET /api/apps/devices': { response: DevicesSnapshot }
  'POST /api/apps/devices/discover': { response: DevicesSnapshot }
  'POST /api/apps/devices/leases': { request: Pick<Extract<DeviceRequest, { action: 'acquire' }>, 'reason' | 'platforms' | 'requestId'>; response: LeaseResult }
  'POST /api/apps/devices/leases/:id/release': { response: Ok | Failure }
  'POST /api/apps/devices/queue/cancel': { request: { requestId: string }; response: Ok }
  'POST /api/apps/devices/:id/control': { request: { operation: 'destroy' }; response: Ok }
  'GET /api/apps/devices/:id/screenshot': { response: DeviceScreenshot }

  'GET /api/apps/files': { response: Directory }
  // ?info=1 时
  'GET /api/apps/files/download': { response: FileInfo }
  'POST /api/apps/files/operation': { request: FileOperation; response: Ok }
  'POST /api/apps/files/upload': { response: Ok }

  'GET /api/apps/kita/conversations': { response: { conversations: Conversation[] } }
  'POST /api/apps/kita/conversations': { request: ConversationMessage; response: { id: string } | { error: 'unavailable' } }
  'POST /api/apps/kita/conversations/:id/messages': { request: Pick<ConversationMessage, 'text'>; response: Ok | { error: 'unavailable' } }
  'POST /api/apps/kita/conversations/:id/stop': { response: Done }
  'POST /api/apps/kita/conversations/:id/delete': { response: Ok | { error: 'answering' } }

  // 音乐 API 的自述，给 agent 读：文字说明和指令的 JSON Schema
  'GET /api/apps/music': { response: { [key: string]: unknown } }
  'GET /api/apps/music/players': { response: { players: PlayerSnapshot[] } }
  'GET /api/apps/music/players/:id': { response: PlayerSnapshot }
  'POST /api/apps/music/players/:id/report': { request: PlayerReport; response: Ok }
  'POST /api/apps/music/players/:id/commands': { request: PlayerCommandRequest; response: CommandResult }
  'GET /api/apps/music/commands/:id': { response: CommandResult }
  'GET /api/apps/music/queue': { response: QueueSnapshot }
  'POST /api/apps/music/queue': { request: QueueMutation; response: QueueSnapshot }
  'GET /api/apps/music/providers': { response: { providers: ProviderInfo[] } }
  // 请求体的键是 ProviderInfo 里 configuration.fields 的 id
  'PUT /api/apps/music/providers/:provider/settings': { request: Record<string, string>; response: ProviderInfo }
  // operation 是 search、resolve、playlist、recommendations 时是 CatalogPage
  'GET /api/apps/music/providers/:provider/:operation': { response: CatalogPage | Lyrics | PlaybackSource }

  'GET /api/apps/system/status': { response: MonitorStatus }
  'POST /api/apps/system/refresh': { response: MonitorStatus }

  'GET /api/apps/terminal': { response: { available: boolean; sessions: TerminalSession[] } }
  'POST /api/apps/terminal/sessions': { response: TerminalSession }
  'DELETE /api/apps/terminal/sessions/:id': { response: Ok | Failure }
  'POST /api/apps/terminal/connections/:token': { request: TerminalClientMessage; response: Ok | Failure }
}

export type Errors = {
  '/api/apps/builds': Failure
  '/api/apps/devices': Failure
  '/api/apps/files': Failure
  '/api/apps/music': MusicApiError
  '/api/apps/terminal': Failure
}

// 每条消息是一个 data 字段里的 JSON；event 为 ping 的是保活，没有 JSON
export type Sse = {
  'GET /api/events': ChangeEvent
  'GET /api/kita/sessions/:id/stream': KitaSessionEvent
  'GET /api/apps/music/players/connect': PlayerMessage
  'GET /api/apps/terminal/sessions/:id/stream': TerminalStreamMessage
}

// 每条消息是一个 JSON 文本帧
export type WebSockets = {
  'GET /api/apps/terminal/sessions/:id/socket': { client: TerminalClientMessage; server: TerminalServerMessage }
  'GET /api/apps/browser/socket': { client: BrowserClientMessage; server: BrowserServerMessage }
}

// 下面在类型检查时核对 Http 和各个路由实际返回的 JSON：路由的响应变了而 Http 没跟着改，pnpm check 就报出是哪个路由。
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

// 前两个有分支返回 c.notFound()，Hono 推断不出它们的 JSON 响应；音乐 API 的自述不是给客户端解析的
type Unchecked = 'POST /api/apps/builds/:id/install' | 'GET /api/apps/music/providers/:provider/:operation' | 'GET /api/apps/music'

type Method<M> = M extends `$${infer Name}` ? Uppercase<Name> : never
type Routes<App, Prefix extends string, S = ExtractSchema<App>> = {
  [P in keyof S & string]: {
    [M in keyof S[P] & string]: S[P][M] extends infer E ? (E extends { outputFormat: 'json'; output: infer O } ? [`${Method<M>} ${MergePath<Prefix, P>}`, O] : never) : never
  }[keyof S[P] & string]
}[keyof S & string]
type Actual = { [K in Mounted[0]]: Extract<Mounted, [K, unknown]>[1] }
type Plain<T> = T extends readonly unknown[] ? Plain<T[number]>[] : T extends object ? { -readonly [K in keyof T]: Plain<T[K]> } : T
type Same<A, B> = (<T>() => T extends Plain<A> ? 1 : 2) extends <T>() => T extends Plain<B> ? 1 : 2 ? true : false
type Checked = Exclude<keyof Http, Unchecked>
type Mismatch = { [K in Checked & keyof Actual]: Same<JSONParsed<Http[K]['response']>, Actual[K]> extends true ? never : K }[Checked & keyof Actual]
type Assert<T extends never> = T
export type RoutesMatch = [Assert<Mismatch>, Assert<Exclude<keyof Actual, keyof Http>>, Assert<Exclude<Checked, keyof Actual>>]
