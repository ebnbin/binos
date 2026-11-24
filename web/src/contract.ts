// 由 scripts/contract.ts 从 server/protocol.schema.json 生成，不要手动修改。后端的契约变了以后在 web/ 里运行 pnpm contract

export type AgentId = 'claude' | 'codex'
export type KitaSessionState = 'idle' | 'running' | 'waiting'
export type Entry =
  | {
      type: 'session'
      time: string
      agent: AgentId
      owner: string
      cwd: string
      instructions?: string
      identity?: IdentityScope
    }
  | {
      type: 'input'
      time: string
      mode: 'start' | 'steer' | 'interrupt'
      text: string
      attachments?: Attachment[]
      model?: string
      effort?: string
    }
  | {
      offset?: number
      parent?: string
      type: 'agent_session'
      time: string
      id: string
    }
  | {
      offset?: number
      parent?: string
      type: 'thinking'
      time: string
      text: string
      durationMs?: number
    }
  | {
      offset?: number
      parent?: string
      type: 'text'
      time: string
      text: string
      files?: {
        [k: string]: string
      }
    }
  | {
      offset?: number
      parent?: string
      clipped?: true
      type: 'tool_call'
      time: string
      id: string
      name: string
      tool: ToolDetail
      input?: unknown
      background?: true
    }
  | {
      offset?: number
      parent?: string
      clipped?: true
      type: 'tool_result'
      time: string
      callId: string
      status: 'done' | 'error'
      output?: string
      truncated?: true
      images?: string[]
      startLine?: number
      links?: WebLink[]
    }
  | {
      offset?: number
      parent?: string
      type: 'compact'
      time: string
      trigger: string
      preTokens?: number
      postTokens?: number
    }
  | {
      type: 'turn_end'
      time: string
      durationMs: number
      outcome?: 'stopped' | 'error'
      error?: string
      model?: string
      modelName?: string
      outputTokens?: number
      context?: Context
      usage?: {
        [k: string]: Tokens
      }
      offset?: number
    }
export type ToolDetail =
  | {
      kind: 'command'
      command: string
    }
  | {
      kind: 'read'
      path: string
    }
  | {
      kind: 'edit'
      path: string
      change?: FileChange
      lines?: LineCount
    }
  | {
      kind: 'search'
      pattern: string
      target: 'content' | 'files'
    }
  | {
      kind: 'web_search'
      query: string
    }
  | {
      kind: 'web_fetch'
      url: string
      prompt?: string
    }
  | {
      kind: 'image_view'
      path: string
    }
  | {
      kind: 'browser'
      action: string
      target?: string
      operation?: BrowserOperation
    }
  | {
      kind: 'mcp'
      server: string
      tool: string
      target?: string
    }
  | {
      kind: 'subagent'
      description: string
      prompt?: string
      type?: string
    }
  | {
      kind: 'tool_search'
      query: string
    }
  | {
      kind: 'skill'
      name: string
    }
  | {
      kind: 'todo'
    }
  | {
      kind: 'other'
      target?: string
    }
export type FileChange =
  | {
      type: 'write'
      content: string
    }
  | {
      type: 'replace'
      before: string
      after: string
      all?: true
    }
  | {
      type: 'diff'
      op: 'add' | 'update' | 'delete'
      diff: string
    }
export type BrowserOperation =
  'navigate' | 'interact' | 'script' | 'read' | 'find' | 'fill' | 'console' | 'network' | 'tabs' | 'open-tab' | 'close-tab' | 'other'
export type MemoryKind = 'stated' | 'inferred'
export type MemorySource =
  | {
      type: 'user'
    }
  | {
      type: 'session'
      owner: string
      session: string
    }
export type ClaudeLoginKind = 'login' | 'token'
export type CodexLoginStatus =
  | {
      status: 'waiting' | 'done'
    }
  | {
      status: 'failed'
      error: string
    }
export type Target = 'web' | 'ios'
export type Artifact =
  | {
      size: number
      sha256: string
      name: string
      kind: 'install'
      platform: 'ios'
    }
  | {
      url: string
      name: string
      kind: 'link'
      platform: 'web'
    }
export type Platform = 'android' | 'ios'
export type DeviceStatus = 'creating' | 'checking' | 'free' | 'reserved' | 'leased' | 'cleaning' | 'destroying' | 'broken'
export type ErrorCode =
  | 'invalid-input'
  | 'unauthorized'
  | 'forbidden'
  | 'not-found'
  | 'conflict'
  | 'gone'
  | 'too-large'
  | 'unsupported-media-type'
  | 'answering'
  | 'busy'
  | 'capacity'
  | 'unavailable'
  | 'configuration'
  | 'unsupported'
  | 'quota'
  | 'network'
  | 'internal'
export type PlaybackStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error'
export type PlayerCommand =
  | {
      type: 'play'
    }
  | {
      type: 'pause'
    }
  | {
      type: 'stop'
    }
  | {
      type: 'next'
    }
  | {
      type: 'previous'
    }
  | {
      ref: TrackRef
      type: 'select'
    }
  | {
      positionMs: number
      type: 'seek'
    }
  | {
      volume: number
      type: 'volume'
    }
  | {
      repeat: 'off' | 'all' | 'one'
      type: 'repeat'
    }
export type QueueOperation =
  | {
      type: 'add' | 'initialize'
      tracks: Track[]
    }
  | {
      type: 'remove'
      ref: TrackRef
    }
  | {
      type: 'move'
      ref: TrackRef
      index: number
    }
  | {
      type: 'clear'
    }
export type Capability =
  | {
      state: 'available'
    }
  | {
      state: 'unsupported'
    }
  | {
      state: 'configuration-required'
      reason: string
    }
export type PlaybackSource =
  | {
      kind: 'audio'
      url: string
      expiresAt?: number
      controls: {
        seek: boolean
        volume: boolean
      }
    }
  | {
      kind: 'embed'
      engine: string
      id: string
      controls: {
        seek: boolean
        volume: boolean
      }
    }
export type ChangeEvent =
  | {
      type: 'session'
      id: number
    }
  | {
      type: 'project'
    }
  | {
      type: 'apps'
    }
  | {
      type: 'agent'
    }
  | {
      type: 'music'
    }
  | {
      type: 'players'
    }
  | {
      type: 'devices'
    }
  | {
      type: 'builds'
    }
  | {
      type: 'kita'
    }
  | {
      type: 'terminal'
    }
export type KitaSessionEvent =
  | {
      type: 'event'
      event: PageEvent
    }
  | {
      type: 'events'
      events: PageEvent[]
    }
  | {
      type: 'live'
      live: Live | null
    }
  | {
      type: 'window'
      session: {
        type: 'session'
        time: string
        agent: AgentId
        owner: string
        cwd: string
        instructions?: string
        identity?: IdentityScope
      }
      events: PageEvent[]
    }
  | LiveEvent
export type Status =
  | {
      type: 'requesting'
    }
  | {
      type: 'thinking'
    }
  | {
      type: 'tool'
      name: string
    }
  | {
      type: 'compacting'
    }
  | {
      type: 'retrying'
      attempt: number
    }
  | {
      type: 'waiting'
      tasks: number
    }
export type LiveEvent =
  | {
      type: 'thinking'
      text: string
    }
  | {
      type: 'text'
      text: string
    }
  | {
      type: 'status'
      status: Status | null
    }
  | {
      type: 'task'
      callId: string
      progress: TaskProgress | null
    }
  | {
      type: 'file'
      path: string
      name: string
    }
export type BuildLogMessage =
  | {
      type: 'log'
      offset: number
      text: string
    }
  | {
      type: 'end'
    }
export type PlayerMessage =
  | {
      type: 'connected'
      playerId: string
    }
  | {
      type: 'command'
      command: CommandResult
    }
export type TerminalClientMessage =
  | {
      type: 'input'
      data: string
    }
  | {
      type: 'resize'
      cols: number
      rows: number
    }
  | {
      type: 'ack'
      size: number
    }
  | {
      type: 'ping'
    }
export type TerminalServerMessage =
  | {
      type: 'output'
      data: string
    }
  | {
      type: 'ready' | 'ping' | 'exit'
    }
  | {
      type: 'error'
      message: string
    }
export type BrowserClientMessage =
  | {
      type: 'navigate'
      url: string
    }
  | {
      type: 'resize'
      width: number
      height: number
      scale: number
    }
  | {
      type: 'pointer'
      action: 'move' | 'down' | 'up'
      x: number
      y: number
      button: 'left' | 'right' | 'middle'
      buttons: number
      clickCount: number
    }
  | {
      type: 'wheel'
      x: number
      y: number
      deltaX: number
      deltaY: number
    }
  | {
      type: 'key'
      action: 'down' | 'up'
      key: string
      code: string
      modifiers: number
    }
  | {
      type: 'text'
      text: string
    }
  | {
      type: 'ack'
      frame: number
    }
  | {
      type: 'back' | 'forward' | 'reload' | 'ping' | 'close'
    }
export type BrowserServerMessage =
  | {
      type: 'ready'
      id: string
    }
  | {
      type: 'state'
      state: BrowserState
    }
  | {
      type: 'frame'
      frame: number
      data: string
      more: boolean
      width: number
      height: number
    }
  | {
      type: 'error'
      message: string
    }
  | {
      type: 'ping' | 'replaced' | 'closed'
    }

export interface Protocol {
  http: Http
  error: ApiError
  sse: Sse
  websocket: WebSockets
  query: Queries
}
export interface Http {
  'GET /api/health': {
    response: Health
  }
  'GET /api/apps': {
    response: Apps
  }
  'PUT /api/apps': {
    request: AppRegistry
  }
  'GET /api/kita/status': {
    response: AgentStatus
  }
  'GET /api/kita/accounts': {
    response: {
      accounts: AgentAccount[]
    }
  }
  'GET /api/kita/agents': {
    response: {
      agents: AgentCatalog[]
    }
  }
  'GET /api/kita/sessions/:id': {
    response: {
      metadata: SessionMetadata
      summary: KitaSessionSummary
      turns: Turn[]
      items: Item[]
    }
  }
  'GET /api/kita/sessions/:id/events': {
    response: {
      events: PageEvent[]
    }
  }
  'GET /api/kita/sessions/:id/calls/:seq': {
    response: CallDetail
  }
  'GET /api/kita/sessions/:id/files/:file': {
    response: FileInfo
    file: '*/*'
  }
  'GET /api/kita/activity': {
    response: {
      activity: Activity[]
    }
  }
  'GET /api/kita/profile': {
    response: {
      profile: Profile
    }
  }
  'PUT /api/kita/profile/description': {
    request: {
      description: string
    }
  }
  'POST /api/kita/profile/photos': {
    response: {
      file: string
    }
  }
  'GET /api/kita/profile/photos/:file': {
    response: FileInfo
    file: 'image/*'
  }
  'DELETE /api/kita/profile/photos/:file': {}
  'PUT /api/kita/profile/avatar': {
    request: {
      file: string
    }
  }
  'GET /api/kita/memories': {
    response: {
      memories: Memory[]
    }
  }
  'POST /api/kita/memories': {
    request: NewMemory
    response: {
      memory: Memory
    }
  }
  'PATCH /api/kita/memories/:id': {
    request: MemoryChange
    response: {
      memory: Memory
    }
  }
  'DELETE /api/kita/memories/:id': {}
  'POST /api/kita/memories/:id/revert': {
    request: {
      session?: string
    }
    response: {
      memory: Memory
    }
  }
  'POST /api/kita/claude/login': {
    request: {
      kind: ClaudeLoginKind
    }
    response: ClaudeLoginStart
  }
  'POST /api/kita/claude/login/:id': {
    request: {
      code: string
    }
  }
  'DELETE /api/kita/claude/login/:id': {}
  'POST /api/kita/codex/login': {
    response: CodexLoginStart
  }
  'GET /api/kita/codex/login/:id': {
    response: CodexLoginStatus
  }
  'DELETE /api/kita/codex/login/:id': {}
  'GET /api/apps/builds': {
    response: BuildsSnapshot
  }
  'POST /api/apps/builds': {
    request: BuildEnqueue
    response: BuildsSnapshot
  }
  'POST /api/apps/builds/poll': {
    response: BuildsSnapshot
  }
  'PUT /api/apps/builds/settings': {
    request: Settings
    response: BuildsSnapshot
  }
  'POST /api/apps/builds/:id/cancel': {
    response: BuildsSnapshot
  }
  'POST /api/apps/builds/:id/retry': {
    response: BuildsSnapshot
  }
  'POST /api/apps/builds/:id/install': {
    response: InstallLink
  }
  'GET /api/apps/builds/:id/log': {
    file: 'text/plain'
  }
  'GET /api/apps/builds/:id/artifacts/:name': {
    file: 'application/octet-stream'
  }
  'GET /api/apps/code/projects': {
    response: {
      projects: Project[]
    }
  }
  'POST /api/apps/code/projects': {
    request: RepositoryBody
    response: {
      project: Project
    }
  }
  'PUT /api/apps/code/projects/:project/repository': {
    request: RepositoryBody
    response: {
      project: Project
    }
  }
  'GET /api/apps/code/search': {
    response: SearchResults
  }
  'GET /api/apps/code/sessions': {
    response: {
      sessions: SessionSummary[]
    }
  }
  'GET /api/apps/code/sessions/:id': {
    response: SessionSummary
  }
  'GET /api/apps/code/usage': {
    response: {
      usage: CodeUsage | null
    }
  }
  'POST /api/apps/code/uploads': {
    response: {
      file: string
    }
  }
  'POST /api/apps/code/sessions': {
    request: MessageBody
    response: SessionRef
  }
  'POST /api/apps/code/sessions/:id/messages': {
    request: MessageBody
    response: SessionRef
  }
  'DELETE /api/apps/code/sessions/:id/queue/:item': {
    response: {
      text: string
    }
  }
  'POST /api/apps/code/sessions/:id/queue/:item/send': {
    response: SessionRef
  }
  'PATCH /api/apps/code/sessions/:id': {
    request: SessionEdit
    response: SessionSummary
  }
  'POST /api/apps/code/sessions/:id/read': {}
  'POST /api/apps/code/sessions/:id/stop': {}
  'GET /api/apps/devices': {
    response: DevicesSnapshot
  }
  'POST /api/apps/devices/discover': {
    response: DevicesSnapshot
  }
  'GET /api/apps/devices/models': {
    response: DeviceModel[]
  }
  'POST /api/apps/devices/leases': {
    request: {
      reason: string
      platforms: Platform[]
      models?: Models
      requestId?: string
    }
    response: LeaseResult
  }
  'DELETE /api/apps/devices/leases/:id': {}
  'DELETE /api/apps/devices/queue/:requestId': {}
  'DELETE /api/apps/devices/:id': {}
  'GET /api/apps/devices/:id/displays': {
    response: DisplayState[]
  }
  'GET /api/apps/devices/:id/screenshot': {
    file: 'image/*'
  }
  'GET /api/apps/files': {
    response: Directory
  }
  'GET /api/apps/files/download': {
    response: FileInfo
    file: '*/*'
  }
  'POST /api/apps/files/directories': {
    request: FileName
  }
  'POST /api/apps/files/rename': {
    request: FileName
  }
  'POST /api/apps/files/copy': {
    request: FileTransfer
    response: FileResults
  }
  'POST /api/apps/files/move': {
    request: FileTransfer
    response: FileResults
  }
  'POST /api/apps/files/trash': {
    request: FileTrash
    response: FileResults
  }
  'POST /api/apps/files/upload': {}
  'GET /api/apps/kita/conversations': {
    response: {
      conversations: Conversation[]
    }
  }
  'POST /api/apps/kita/conversations': {
    request: ConversationMessage
    response: {
      id: string
    }
  }
  'POST /api/apps/kita/conversations/:id/messages': {
    request: {
      text: string
    }
  }
  'POST /api/apps/kita/conversations/:id/stop': {}
  'DELETE /api/apps/kita/conversations/:id': {}
  'GET /api/apps/music': {
    response: {
      [k: string]: unknown
    }
  }
  'GET /api/apps/music/players': {
    response: {
      players: PlayerSnapshot[]
    }
  }
  'GET /api/apps/music/players/:id': {
    response: PlayerSnapshot
  }
  'POST /api/apps/music/players/:id/report': {
    request: PlayerReport
  }
  'POST /api/apps/music/players/:id/commands': {
    request: PlayerCommandRequest
    response: CommandResult
  }
  'GET /api/apps/music/commands/:id': {
    response: CommandResult
  }
  'GET /api/apps/music/queue': {
    response: QueueSnapshot
  }
  'POST /api/apps/music/queue': {
    request: QueueMutation
    response: QueueSnapshot
  }
  'GET /api/apps/music/providers': {
    response: {
      providers: ProviderInfo[]
    }
  }
  'PATCH /api/apps/music/providers/:provider/settings': {
    request: ProviderSettings
    response: ProviderInfo
  }
  'GET /api/apps/music/providers/:provider/stream': {
    file: 'audio/*'
  }
  'GET /api/apps/music/providers/:provider/:operation': {
    response: CatalogPage | Lyrics | PlaybackSource
  }
  'GET /api/apps/system/status': {
    response: MonitorStatus
  }
  'POST /api/apps/system/refresh': {
    response: MonitorStatus
  }
  'GET /api/apps/terminal': {
    response: {
      available: boolean
      sessions: TerminalSession[]
    }
  }
  'POST /api/apps/terminal/sessions': {
    response: TerminalSession
  }
  'DELETE /api/apps/terminal/sessions/:id': {}
}
export interface Health {
  version: string
  protocol: string
}
export interface Apps {
  builtin: BuiltinApp[]
  external: ExternalApp[]
}
export interface BuiltinApp {
  id: string
  name: string
}
export interface ExternalApp {
  id: string
  name: string
  icon: string
  url: string
}
export interface AppRegistry {
  external: ExternalApp[]
}
export interface AgentStatus {
  limits: {
    claude?: Limits
    codex?: Limits
  }
  auth: {
    claude?: ClaudeAuth
    codex?: CodexAuth
  }
  attention: {
    claude?: AgentAttention
    codex?: AgentAttention
  }
}
export interface Limits {
  limited: boolean
  windows: QuotaWindow[]
  updatedAt: string
}
export interface QuotaWindow {
  id: string
  minutes: number
  label?: string
  utilization: number
  resetsAt: number
}
export interface ClaudeAuth {
  mode: 'login' | 'token' | 'none'
  login?: {
    expiresAt?: string
    broken?: true
  }
  backup?: {
    expiresAt?: string
  }
}
export interface CodexAuth {
  loggedIn: boolean
  broken?: true
}
export interface AgentAttention {
  reason: 'logged-out' | 'login-expired' | 'login-broken' | 'login-expiring' | 'backup-expiring'
  usable: boolean
  expiresAt?: string
}
export interface AgentAccount {
  agent: AgentId
  version?: string
  loggedIn: boolean
  email?: string
  plan?: string
  token?: {
    expiresAt?: string
    refreshedAt?: string
    refreshable: boolean
  }
  details: AccountDetail[]
  configDir: string
  running: number
}
export interface AccountDetail {
  label: string
  value: string
  note?: string
}
export interface AgentCatalog {
  agent: AgentId
  available: boolean
  models: AgentModel[]
  efforts: string[]
}
export interface AgentModel {
  id: string
  name: string
  efforts: string[]
  isDefault?: boolean
}
export interface SessionMetadata {
  format: 1
  id: string
  type: 'session'
  time: string
  agent: AgentId
  owner: string
  cwd: string
  instructions?: string
  identity?: IdentityScope
}
export interface IdentityScope {
  read: string[]
  write: string
}
export interface KitaSessionSummary {
  id: string
  agent: AgentId
  createdAt: string
  updatedAt: string
  state: KitaSessionState
  turns: number
  outcome?: 'stopped' | 'error'
  context?: Context
  repliedAt?: string
  model?: string
  modelName?: string
  effort?: string
  usage: {
    [k: string]: Tokens
  }
  costs: [string, number][]
}
export interface Context {
  tokens: number
  window: number
}
export interface Tokens {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}
export interface Turn {
  id: string
  startedAt: string
  finishedAt?: string
  outcome?: 'stopped' | 'error'
  error?: string
}
export interface Item {
  id: string
  turnId: string | null
  kind: 'input' | 'text' | 'thinking' | 'tool' | 'compact'
  entries: Entry[]
}
export interface Attachment {
  file: string
  name: string
}
export interface LineCount {
  added: number
  removed: number
}
export interface WebLink {
  title: string
  url: string
}
export interface PageEvent {
  parentId?: string
  seq: number
  turnId: string | null
  itemId: string | null
  data: Entry
}
export interface CallDetail {
  call: PageEvent
  result?: PageEvent
}
export interface FileInfo {
  size: number
  modified: string
  type: string
}
export interface Activity {
  session: string
  owner: string
  state: 'running' | 'waiting'
  since: string
}
export interface Profile {
  description: string
  photos: Photo[]
  avatar?: string
}
export interface Photo {
  file: string
  addedAt: string
}
export interface Memory {
  id: string
  text: string
  kind: MemoryKind
  scope: string
  source: MemorySource
  createdAt: string
  updatedAt: string
  history: {
    text: string
    kind: MemoryKind
    time: string
    source: MemorySource
  }[]
}
export interface NewMemory {
  session?: string
  text: string
  kind?: MemoryKind
  scope?: string
}
export interface MemoryChange {
  session?: string
  text?: string
  kind?: MemoryKind
}
export interface ClaudeLoginStart {
  id: string
  url: string
}
export interface CodexLoginStart {
  id: string
  url: string
  code: string
}
export interface BuildsSnapshot {
  builds: Build[]
  settings: Settings
  pollError?: string
  checkedAt?: string
  prs?: {
    number: number
    title: string
  }[]
  mode: 'real' | 'mock'
  version: string
}
export interface Build {
  id: string
  commit: string
  target: Target
  trigger: 'main' | 'pr' | 'manual'
  pr?: number
  status: 'queued' | 'running' | 'success' | 'failed' | 'cancelled' | 'interrupted'
  createdAt: string
  startedAt?: string
  endedAt?: string
  error?: string
  artifacts: Artifact[]
}
export interface Settings {
  automatic: boolean
}
export interface BuildEnqueue {
  ref: string
  targets: Target[]
}
export interface InstallLink {
  url: string
  expiresIn: number
}
export interface Project {
  id: string
  name: string
  repository?: string
  defaultBranch?: string
}
export interface RepositoryBody {
  name: string
  repository: string
  create?: boolean
}
export interface SearchResults {
  results: SearchResult[]
  total: number
}
export interface SearchResult {
  id: number
  title: string
  archived: boolean
  seq?: number
  kind: 'title' | 'input' | 'text'
  before: string
  match: string
  after: string
}
export interface SessionSummary {
  project: string
  id: number
  kitaSession: string
  title: string
  updatedAt: string
  running: boolean
  waiting: boolean
  unread: boolean
  outcome?: 'stopped' | 'error'
  pinned: boolean
  archived: boolean
  context?: Context
  agent: AgentId
  model?: string
  modelName?: string
  effort?: string
  turns: number
  tokens?: Tokens
  priced: boolean
  quota?: number
  prs: PullRequest[]
  queue: QueuedMessage[]
}
export interface PullRequest {
  url: string
  number: number
  state?: 'open' | 'merged' | 'closed'
  title?: string
  preview?: string
}
export interface QueuedMessage {
  id: string
  time: string
  text: string
  attachments?: Upload[]
  model?: string
  effort?: string
}
export interface Upload {
  file: string
  name: string
}
export interface CodeUsage {
  resetsAt: number
  week?: number
}
export interface MessageBody {
  requestId?: string
  project?: string
  text: string
  attachments?: Upload[]
  interrupt?: boolean
  queue?: boolean
  agent?: AgentId
  model?: string
  effort?: string
}
export interface SessionRef {
  id: number
  kitaSession: string
}
export interface SessionEdit {
  title?: string
  pinned?: boolean
  archived?: boolean
}
export interface DevicesSnapshot {
  owners: {
    [k: string]: {
      session: number
      title: string
    }
  }
  capacity: number
  build: string
  mode: 'mock' | 'real'
  pid: number
  startedAt: number
  observed: ObservedDevice[]
  discoveryErrors: string[]
  version: 2
  bootTime?: number
  devices: Device[]
  leases: Lease[]
  queue: Waiting[]
  ended: {
    id: string
    owner: string
    at: number
  }[]
  events: DeviceEvent[]
}
export interface ObservedDevice {
  platform: Platform
  name: string
  target: string
  state: string
}
export interface Device {
  id: string
  platform: Platform
  name: string
  target: string
  system?: string
  model?: string
  modelName?: string
  iosSet?: string
  displays?: DeviceDisplay[]
  status: DeviceStatus
  generation?: string
  idleSince?: number
  error?: string
  checkedAt?: number
  attempts?: number
  retryAt?: number
}
export interface DeviceDisplay {
  id: string
  name: string
  width: number
  height: number
  uid?: string
}
export interface Lease {
  requestId: string
  claimed?: true
  id: string
  owner: string
  reason: string
  platforms: Platform[]
  models?: Models
  devices: string[]
  createdAt: number
  lastSeen: number
}
export interface Models {
  android?: string
  ios?: string
}
export interface Waiting {
  id: string
  owner: string
  reason: string
  platforms: Platform[]
  models?: Models
  devices: string[]
  phase: 'waiting' | 'preparing' | 'failed'
  error?: string
  createdAt: number
  lastSeen: number
  preparingAt?: number
}
export interface DeviceEvent {
  time: number
  text: string
  device?: string
  owner?: string
}
export interface DeviceModel {
  platform: Platform
  id: string
  name: string
  family: string
  systems: string[]
  default?: true
}
export interface LeaseResult {
  requestId: string
  lease?: Lease
  position?: number
  phase?: 'waiting' | 'preparing' | 'failed'
  error?: string
  env?: {
    [k: string]: string
  }
}
export interface DisplayState {
  active?: boolean
  id: string
  name: string
  width: number
  height: number
  uid?: string
}
export interface Directory {
  path: string
  parent: string
  home: string
  entries: FileEntry[]
}
export interface FileEntry {
  name: string
  path: string
  directory: boolean
  symlink: boolean
  size: number
  modified: number
}
export interface FileName {
  path: string
  name: string
}
export interface FileTransfer {
  paths: string[]
  destination: string
}
export interface FileResults {
  results: FileResult[]
}
export interface FileResult {
  path: string
  error?: {
    code: ErrorCode
    message: string
  }
}
export interface FileTrash {
  paths: string[]
}
export interface Conversation {
  id: string
  title: string
  temporary: boolean
  agent: AgentId
  state: KitaSessionState
  createdAt: string
  updatedAt: string
  outcome?: 'stopped' | 'error'
}
export interface ConversationMessage {
  text: string
  temporary?: boolean
  agent?: AgentId
}
export interface PlayerSnapshot {
  id: string
  label: string
  updatedAt: number
  state: PlayerState | null
}
export interface PlayerState {
  track: TrackRef | null
  status: PlaybackStatus
  positionMs: number
  durationMs: number
  volume: number
  repeat: 'off' | 'all' | 'one'
  controls: {
    seek: boolean
    volume: boolean
  }
  error?: string
}
export interface TrackRef {
  provider: string
  id: string
}
export interface PlayerReport {
  state: PlayerState
  result?: {
    id: string
    error?: string
  }
}
export interface PlayerCommandRequest {
  id: string
  command: PlayerCommand
}
export interface CommandResult {
  id: string
  playerId: string
  command: PlayerCommand
  status: 'pending' | 'succeeded' | 'failed'
  createdAt: number
  expiresAt: number
  state?: PlayerState
  error?: {
    code: 'disconnected' | 'timeout' | 'execution'
    message: string
  }
}
export interface QueueSnapshot {
  revision: number
  tracks: Track[]
}
export interface Track {
  ref: TrackRef
  title: string
  artists: string[]
  album?: {
    id?: string
    title: string
  }
  artworkUrl?: string
  durationMs?: number
  externalUrl: string
}
export interface QueueMutation {
  id: string
  operation: QueueOperation
}
export interface ProviderInfo {
  id: string
  name: string
  description: string
  input: {
    references: {
      pattern: string
      capability: 'resolve' | 'playlist'
    }[]
  }
  capabilities: ProviderCapabilities
  stream?: {
    provider: string
  }
  configuration: {
    fields: {
      id: string
      label: string
      description: string
      secret: boolean
      configured: boolean
      links?: {
        label: string
        url: string
      }[]
    }[]
  }
}
export interface ProviderCapabilities {
  search: Capability
  resolve: Capability
  playlist: Capability
  recommendations: Capability
  lyrics: Capability
  playback: Capability
}
export interface ProviderSettings {
  [k: string]: string | null
}
export interface CatalogPage {
  tracks: Track[]
  nextPage?: string
  warning?: string
}
export interface Lyrics {
  text: string
  attribution?: string
}
export interface MonitorStatus {
  snapshot: SystemSnapshot | null
  collecting: boolean
  collectionError?: string
}
export interface SystemSnapshot {
  at: number
  host: {
    name: string
    model: string
    chip: string
    os: string
    uptime: number
    cores: number
  }
  cpu: {
    percent: number | null
  }
  memory: {
    total: number
    free: number
    cached: number | null
    pressure: 'normal' | 'warning' | 'critical' | 'unknown'
  }
  volumes: Volume[]
  network: {
    receiveRate: number | null
    sendRate: number | null
  }
  power: {
    source: string
    battery: number | null
  }
  runtime: {
    version: string
    uptime: number
    memory: number
    test: boolean
  }
  unavailable: string[]
}
export interface Volume {
  filesystem: string
  mount: string
  total: number
  available: number
  used: number
}
export interface TerminalSession {
  id: string
  created: number
  cwd: string
  command: string
}
export interface ApiError {
  error: {
    code: ErrorCode
    message: string
  }
}
export interface Sse {
  'GET /api/events': ChangeEvent
  'GET /api/kita/sessions/:id/stream': KitaSessionEvent
  'GET /api/apps/builds/:id/log/stream': BuildLogMessage
  'GET /api/apps/system/stream': MonitorStatus
  'GET /api/apps/music/players/connect': PlayerMessage
}
export interface Live {
  thinking: string
  text: string
  status: Status | null
  tasks: {
    [k: string]: TaskProgress
  }
  files: {
    [k: string]: string
  }
}
export interface TaskProgress {
  activity?: string
  toolUses?: number
  tokens?: number
}
export interface WebSockets {
  'GET /api/apps/terminal/sessions/:id/socket': {
    client: TerminalClientMessage
    server: TerminalServerMessage
  }
  'GET /api/apps/browser/socket': {
    client: BrowserClientMessage
    server: BrowserServerMessage
  }
}
export interface BrowserState {
  url: string
  title: string
  canBack: boolean
  canForward: boolean
}
export interface Queries {
  'GET /api/kita/sessions/:id/events': {
    from?: string
    before?: string
    limit?: string
  }
  'GET /api/kita/sessions/:id/files/:file': FileQuery
  'GET /api/kita/profile/photos/:file': FileQuery
  'GET /api/kita/sessions/:id/stream': {
    from?: string
    tail?: string
  }
  'DELETE /api/kita/memories/:id': {
    session?: string
  }
  'GET /api/apps/builds/:id/log/stream': {
    from?: string
  }
  'GET /api/apps/code/sessions': {
    q?: string
  }
  'GET /api/apps/code/search': {
    q: string
  }
  'GET /api/apps/devices/:id/screenshot': {
    display?: string
  }
  'GET /api/apps/files': {
    path?: string
  }
  'GET /api/apps/files/download': {
    path: string
    info?: '1'
    name?: string
  }
  'POST /api/apps/files/upload': {
    path: string
    name: string
  }
  'GET /api/apps/music/players/connect': {
    label: string
  }
  'GET /api/apps/music/providers/:provider/stream': {
    id: string
  }
  'GET /api/apps/music/providers/:provider/:operation': {
    q: string
    page?: string
  }
  'GET /api/apps/browser/socket': {
    session?: string
  }
}
export interface FileQuery {
  info?: '1'
  name?: string
}
export interface Protocol1 {
  http: Http
  error: ApiError
  sse: Sse
  websocket: WebSockets
  query: Queries
}
