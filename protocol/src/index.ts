import type { BrowserClientMessage, BrowserServerMessage } from './apps/browser.js'
import type { BuildEnqueue, BuildLogMessage, BuildsSnapshot, InstallLink, Settings } from './apps/builds.js'
import type { CodeUsage, MessageBody, Project, RepositoryBody, SearchResults, SessionEdit, SessionRef, SessionSummary } from './apps/code.js'
import type { DeviceModel, DevicesSnapshot, DisplayState, LeaseResult, Models, Platform } from './apps/devices.js'
import type { Directory, FileName, FileResults, FileTransfer, FileTrash } from './apps/files.js'
import type { Conversation, ConversationMessage } from './apps/kita.js'
import type { CatalogPage, CommandResult, Lyrics, PlaybackSource, PlayerCommandRequest, PlayerMessage, PlayerReport, PlayerSnapshot, ProviderInfo, ProviderSettings, QueueMutation, QueueSnapshot } from './apps/music.js'
import type { MonitorStatus } from './apps/system.js'
import type { TerminalClientMessage, TerminalServerMessage, TerminalSession } from './apps/terminal.js'
import type { ApiError, AppRegistry, Apps, ChangeEvent, FileInfo, Health } from './core.js'
import type {
  Activity,
  AgentAccount,
  AgentCatalog,
  AgentStatus,
  CallDetail,
  ClaudeLoginKind,
  ClaudeLoginStart,
  CodexLoginStart,
  CodexLoginStatus,
  Item,
  KitaSessionEvent,
  KitaSessionSummary,
  Memory,
  MemoryChange,
  NewMemory,
  PageEvent,
  Profile,
  SessionMetadata,
  Turn,
} from './services/kita.js'

// 客户端收发的全部 JSON：pnpm protocol 由它生成 server/protocol.schema.json，schema 的标识见 server/src/protocol-id.ts。
// server 挂上的每个路由都登记在 Http、Sse 或 WebSockets 里，server/src/protocol.ts 和 protocol.test.ts 检查。
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
  'GET /api/apps': { response: Apps }
  'PUT /api/apps': { request: AppRegistry }

  'GET /api/kita/status': { response: AgentStatus }
  'GET /api/kita/accounts': { response: { accounts: AgentAccount[] } }
  'GET /api/kita/agents': { response: { agents: AgentCatalog[] } }
  'GET /api/kita/sessions/:id': { response: { metadata: SessionMetadata; summary: KitaSessionSummary; turns: Turn[]; items: Item[] } }
  // ?from=：seq 大于它的；?before=&limit=：seq 小于它的至少 limit 条，从一轮的开头起
  'GET /api/kita/sessions/:id/events': { response: { events: PageEvent[] } }
  // seq 是 tool_call 事件的 seq
  'GET /api/kita/sessions/:id/calls/:seq': { response: CallDetail }
  // ?info=1 时是 response；?name= 是下载时的文件名
  'GET /api/kita/sessions/:id/files/:file': { response: FileInfo; file: '*/*' }
  'GET /api/kita/activity': { response: { activity: Activity[] } }
  'GET /api/kita/profile': { response: { profile: Profile } }
  'PUT /api/kita/profile/description': { request: { description: string } }
  'POST /api/kita/profile/photos': { response: { file: string } }
  // ?info=1 时是 response
  'GET /api/kita/profile/photos/:file': { response: FileInfo; file: 'image/*' }
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
  // 完整的日志
  'GET /api/apps/builds/:id/log': { file: 'text/plain' }
  'GET /api/apps/builds/:id/artifacts/:name': { file: 'application/octet-stream' }

  'GET /api/apps/code/projects': { response: { projects: Project[] } }
  'POST /api/apps/code/projects': { request: RepositoryBody; response: { project: Project } }
  'PUT /api/apps/code/projects/:project/repository': { request: RepositoryBody; response: { project: Project } }
  'GET /api/apps/code/search': { response: SearchResults }
  'GET /api/apps/code/sessions': { response: { sessions: SessionSummary[] } }
  'GET /api/apps/code/sessions/:id': { response: SessionSummary }
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
  'GET /api/apps/devices/models': { response: DeviceModel[] }
  'POST /api/apps/devices/leases': { request: { reason: string; platforms: Platform[]; models?: Models; requestId?: string }; response: LeaseResult }
  'DELETE /api/apps/devices/leases/:id': {}
  'DELETE /api/apps/devices/queue/:requestId': {}
  'DELETE /api/apps/devices/:id': {}
  'GET /api/apps/devices/:id/displays': { response: DisplayState[] }
  // Last-Modified 是截图的时间；?display= 是屏幕，不填时截正在显示内容的屏幕
  'GET /api/apps/devices/:id/screenshot': { file: 'image/*' }

  'GET /api/apps/files': { response: Directory }
  // ?path= 是文件；?info=1 时是 response；?name= 是下载时的文件名
  'GET /api/apps/files/download': { response: FileInfo; file: '*/*' }
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
  // ?id= 是曲目的 id，支持 Range
  'GET /api/apps/music/providers/:provider/stream': { file: 'audio/*' }
  // operation 是 search、resolve、playlist、recommendations 时是 CatalogPage
  'GET /api/apps/music/providers/:provider/:operation': { response: CatalogPage | Lyrics | PlaybackSource }

  'GET /api/apps/system/status': { response: MonitorStatus }
  'POST /api/apps/system/refresh': { response: MonitorStatus }

  'GET /api/apps/terminal': { response: { available: boolean; sessions: TerminalSession[] } }
  'POST /api/apps/terminal/sessions': { response: TerminalSession }
  'DELETE /api/apps/terminal/sessions/:id': {}
}

// 每条消息是一个 data 字段里的 JSON；event 为 ping 的是保活，没有 JSON
export type Sse = {
  'GET /api/events': ChangeEvent
  'GET /api/kita/sessions/:id/stream': KitaSessionEvent
  // SSE 的 id 是读到的字节位置，断线重连时带上 Last-Event-ID（或 ?from=）
  'GET /api/apps/builds/:id/log/stream': BuildLogMessage
  'GET /api/apps/system/stream': MonitorStatus
  'GET /api/apps/music/players/connect': PlayerMessage
}

// 每条消息是一个 JSON 文本帧
export type WebSockets = {
  'GET /api/apps/terminal/sessions/:id/socket': { client: TerminalClientMessage; server: TerminalServerMessage }
  'GET /api/apps/browser/socket': { client: BrowserClientMessage; server: BrowserServerMessage }
}
