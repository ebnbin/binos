import type { ExtractSchema, MergePath } from 'hono/types'
import type { JSONParsed } from 'hono/utils/types'
import type { api } from './api.js'
import type { browserApi } from './apps/browser/api.js'
import type { BrowserClientMessage, BrowserServerMessage } from './apps/browser/protocol.js'
import type { buildsApi } from './apps/builds/api.js'
import type { BuildEnqueue, BuildsSnapshot, InstallLink, Settings } from './apps/builds/types.js'
import type { codeApi } from './apps/code/api.js'
import type { CodeUsage, MessageBody, Project, RepositoryBody, SearchResults, SessionEdit, SessionRef, SessionSummary } from './apps/code/types.js'
import type { devicesApi, DevicesSnapshot } from './apps/devices/api.js'
import type { DeviceScreenshot, LeaseResult, Request as DeviceRequest } from './apps/devices/types.js'
import type { filesApi } from './apps/files/api.js'
import type { Directory, FileName, FileResults, FileTransfer, FileTrash } from './apps/files/types.js'
import type { kitaAppApi } from './apps/kita/api.js'
import type { Conversation, ConversationMessage } from './apps/kita/types.js'
import type { musicApi } from './apps/music/api.js'
import type { CatalogPage, CommandResult, Lyrics, PlaybackSource, PlayerCommandRequest, PlayerMessage, PlayerReport, PlayerSnapshot, ProviderInfo, ProviderSettings, QueueMutation, QueueSnapshot } from './apps/music/types.js'
import type { systemApi } from './apps/system/api.js'
import type { MonitorStatus } from './apps/system/types.js'
import type { terminalApi } from './apps/terminal/api.js'
import type { TerminalClientMessage, TerminalServerMessage, TerminalStreamMessage } from './apps/terminal/connection.js'
import type { TerminalSession } from './apps/terminal/sessions.js'
import type { ApiError } from './errors.js'
import type { FileInfo } from './files.js'
import type { claudeApi } from './services/kita/drivers/claude/api.js'
import type { ClaudeLoginKind, ClaudeLoginStart } from './services/kita/drivers/claude/login.js'
import type { codexApi } from './services/kita/drivers/codex/api.js'
import type { CodexLoginStart, CodexLoginStatus } from './services/kita/drivers/codex/login.js'
import type { CallDetail, Item, PageEvent, SessionMetadata, Turn } from './services/kita/journal.js'
import type { Activity, AgentAccount, AgentCatalog, AgentStatus, KitaSessionEvent, KitaSessionSummary, Memory, MemoryChange, NewMemory, Profile } from './services/kita/types.js'
import type { AppRegistry, ChangeEvent, Health } from './types.js'

// 客户端收发的全部 JSON：pnpm protocol 由它生成 server/protocol.schema.json，schema 的标识见 protocol-id.ts。
// http 的 request 是 JSON 请求体（请求体是文件本身时没有），成功时：有 response 的返回这个 JSON，
// file 是响应体为文件本身（图片、音频、日志……），两样都没有的是 204、没有响应体。出错时（4xx、5xx）所有接口的响应体都是 error
export type Protocol = {
  http: Http
  error: ApiError
  sse: Sse
  websocket: WebSockets
}

export type Http = {
  'GET /api/health': { response: Health }
  'GET /api/apps': { response: AppRegistry }
  'PUT /api/apps': { request: AppRegistry }

  'GET /api/kita/status': { response: AgentStatus }
  'GET /api/kita/accounts': { response: { accounts: AgentAccount[] } }
  'GET /api/kita/agents': { response: { agents: AgentCatalog[] } }
  'GET /api/kita/sessions/:id': { response: { metadata: SessionMetadata; summary: KitaSessionSummary; turns: Turn[]; items: Item[] } }
  // ?from=：seq 大于它的；?before=&limit=：seq 小于它的至少 limit 条，从一轮的开头起
  'GET /api/kita/sessions/:id/events': { response: { events: PageEvent[] } }
  // seq 是 tool_call 事件的 seq
  'GET /api/kita/sessions/:id/calls/:seq': { response: CallDetail }
  // ?info=1 时
  'GET /api/kita/sessions/:id/files/:file': { response: FileInfo }
  'GET /api/kita/activity': { response: { activity: Activity[] } }
  'GET /api/kita/profile': { response: { profile: Profile } }
  'PUT /api/kita/profile/description': { request: { description: string } }
  'POST /api/kita/profile/photos': { response: { file: string } }
  // ?info=1 时
  'GET /api/kita/profile/photos/:file': { response: FileInfo }
  'DELETE /api/kita/profile/photos/:file': {}
  'PUT /api/kita/profile/avatar': { request: { file: string } }
  'GET /api/kita/memories': { response: { memories: Memory[] } }
  'POST /api/kita/memories': { request: NewMemory; response: { memory: Memory } }
  'PATCH /api/kita/memories/:id': { request: MemoryChange; response: { memory: Memory } }
  // ?session= 是 agent 在哪个 session 里删的，页面上的用户不带
  'DELETE /api/kita/memories/:id': {}
  'POST /api/kita/memories/:id/revert': { request: Pick<MemoryChange, 'session'>; response: { memory: Memory } }
  'POST /api/kita/claude/login': { request: { kind: ClaudeLoginKind }; response: ClaudeLoginStart }
  'POST /api/kita/claude/login/:id': { request: { code: string } }
  'DELETE /api/kita/claude/login/:id': {}
  'POST /api/kita/codex/login': { response: CodexLoginStart }
  'GET /api/kita/codex/login/:id': { response: CodexLoginStatus }
  'DELETE /api/kita/codex/login/:id': {}

  'GET /api/apps/builds': { response: BuildsSnapshot }
  'POST /api/apps/builds': { request: BuildEnqueue; response: BuildsSnapshot }
  'POST /api/apps/builds/poll': { response: BuildsSnapshot }
  'PUT /api/apps/builds/settings': { request: Settings; response: BuildsSnapshot }
  'POST /api/apps/builds/:id/cancel': { response: BuildsSnapshot }
  'POST /api/apps/builds/:id/retry': { response: BuildsSnapshot }
  'POST /api/apps/builds/:id/install': { response: InstallLink }

  'GET /api/apps/code/projects': { response: { projects: Project[] } }
  'POST /api/apps/code/projects': { request: RepositoryBody; response: { project: Project } }
  'PUT /api/apps/code/projects/:project/repository': { request: RepositoryBody; response: { project: Project } }
  'GET /api/apps/code/search': { response: SearchResults }
  'GET /api/apps/code/sessions': { response: { sessions: SessionSummary[] } }
  'GET /api/apps/code/usage': { response: { usage: CodeUsage | null } }
  'POST /api/apps/code/uploads': { response: { file: string } }
  'POST /api/apps/code/sessions': { request: MessageBody; response: SessionRef }
  'POST /api/apps/code/sessions/:id/messages': { request: MessageBody; response: SessionRef }
  // 撤回排队的消息，返回它的文字
  'DELETE /api/apps/code/sessions/:id/queue/:item': { response: { text: string } }
  'POST /api/apps/code/sessions/:id/queue/:item/send': { response: SessionRef }
  'PATCH /api/apps/code/sessions/:id': { request: SessionEdit; response: SessionSummary }
  'POST /api/apps/code/sessions/:id/read': {}
  'POST /api/apps/code/sessions/:id/stop': {}

  'GET /api/apps/devices': { response: DevicesSnapshot }
  'POST /api/apps/devices/discover': { response: DevicesSnapshot }
  'POST /api/apps/devices/leases': { request: Pick<Extract<DeviceRequest, { action: 'acquire' }>, 'reason' | 'platforms' | 'requestId'>; response: LeaseResult }
  'DELETE /api/apps/devices/leases/:id': {}
  'DELETE /api/apps/devices/queue/:requestId': {}
  'DELETE /api/apps/devices/:id': {}
  'GET /api/apps/devices/:id/screenshot': { response: DeviceScreenshot }

  'GET /api/apps/files': { response: Directory }
  // ?info=1 时
  'GET /api/apps/files/download': { response: FileInfo }
  'POST /api/apps/files/directories': { request: FileName }
  'POST /api/apps/files/rename': { request: FileName }
  'POST /api/apps/files/copy': { request: FileTransfer; response: FileResults }
  'POST /api/apps/files/move': { request: FileTransfer; response: FileResults }
  'POST /api/apps/files/trash': { request: FileTrash; response: FileResults }
  // ?path= 目录、?name= 文件名，请求体是文件本身
  'POST /api/apps/files/upload': {}

  'GET /api/apps/kita/conversations': { response: { conversations: Conversation[] } }
  'POST /api/apps/kita/conversations': { request: ConversationMessage; response: { id: string } }
  'POST /api/apps/kita/conversations/:id/messages': { request: Pick<ConversationMessage, 'text'> }
  'POST /api/apps/kita/conversations/:id/stop': {}
  'DELETE /api/apps/kita/conversations/:id': {}

  // 音乐 API 的自述，给 agent 读：文字说明和指令的 JSON Schema
  'GET /api/apps/music': { response: { [key: string]: unknown } }
  'GET /api/apps/music/players': { response: { players: PlayerSnapshot[] } }
  'GET /api/apps/music/players/:id': { response: PlayerSnapshot }
  'POST /api/apps/music/players/:id/report': { request: PlayerReport }
  'POST /api/apps/music/players/:id/commands': { request: PlayerCommandRequest; response: CommandResult }
  'GET /api/apps/music/commands/:id': { response: CommandResult }
  'GET /api/apps/music/queue': { response: QueueSnapshot }
  'POST /api/apps/music/queue': { request: QueueMutation; response: QueueSnapshot }
  'GET /api/apps/music/providers': { response: { providers: ProviderInfo[] } }
  'PATCH /api/apps/music/providers/:provider/settings': { request: ProviderSettings; response: ProviderInfo }
  // operation 是 search、resolve、playlist、recommendations 时是 CatalogPage
  'GET /api/apps/music/providers/:provider/:operation': { response: CatalogPage | Lyrics | PlaybackSource }

  'GET /api/apps/system/status': { response: MonitorStatus }
  'POST /api/apps/system/refresh': { response: MonitorStatus }

  'GET /api/apps/terminal': { response: { available: boolean; sessions: TerminalSession[] } }
  'POST /api/apps/terminal/sessions': { response: TerminalSession }
  'DELETE /api/apps/terminal/sessions/:id': {}
  'POST /api/apps/terminal/connections/:token': { request: TerminalClientMessage; response: { ok: true } }
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
export type RoutesMatch = [Assert<Mismatch>, Assert<Exclude<keyof Actual, keyof Http>>, Assert<Exclude<Checked, keyof Actual>>]
