import type { PageEvent } from './journal.js'

export type Context = { tokens: number; window: number }
// 用掉的 token：输入、输出、读缓存、写缓存
export type Tokens = { input: number; output: number; cacheRead: number; cacheWrite: number }

// 能用的 agent 和显示的名字。怎么接入在服务端的 drivers/，按同样的 id 对应
export const agents = {
  claude: { name: 'Claude' },
  codex: { name: 'Codex' },
} as const satisfies Record<string, { name: string }>
export type AgentId = keyof typeof agents
export const agentIds = Object.keys(agents) as AgentId[]
// 没选 agent 的新对话用它
export const defaultAgent: AgentId = 'claude'

// 能选的模型：efforts 是它支持的思考程度，isDefault 是不指定模型时 agent 用的
export type AgentModel = { id: string; name: string; efforts: string[]; isDefault?: boolean }
// 一个 agent 能不能用（装了、登录了），能选哪些模型；efforts 是不指定模型时能选的思考程度
export type AgentCatalog = { agent: AgentId; available: boolean; models: AgentModel[]; efforts: string[] }

// 用户发消息时附上的文件。file 是 session 的 files/ 里的文件名，name 是原来的文件名
export type Attachment = { file: string; name: string }

// 一次工具调用做的是什么，各个 agent 的工具都归到这几类。不认识的是 other，页面显示原始的工具名和参数
export type ToolDetail =
  | { kind: 'command'; command: string }
  | { kind: 'read'; path: string }
  // 没有 change 时（比如改 notebook）页面显示原始参数
  | { kind: 'edit'; path: string; change?: FileChange }
  // target：搜内容还是搜文件名
  | { kind: 'search'; pattern: string; target: 'content' | 'files' }
  | { kind: 'web_search'; query: string }
  | { kind: 'web_fetch'; url: string; prompt?: string }
  | { kind: 'image_view'; path: string }
  // action 是浏览器工具的名字，target 是它操作的对象（网址、查找的文字……）
  | { kind: 'browser'; action: string; target?: string }
  | { kind: 'mcp'; server: string; tool: string }
  | { kind: 'subagent'; description: string; prompt?: string; type?: string }
  // 按需加载工具的定义
  | { kind: 'tool_search'; query: string }
  | { kind: 'skill'; name: string }
  | { kind: 'todo' }
  | { kind: 'other' }
export type ToolKind = ToolDetail['kind']

// 改一个文件：整个写入、替换一段（all：替换全部出现的地方）、按 diff 新建、修改或删除
export type FileChange =
  | { type: 'write'; content: string }
  | { type: 'replace'; before: string; after: string; all?: true }
  | { type: 'diff'; op: 'add' | 'update' | 'delete'; diff: string }

// offset 是产生它的那一行在 agent 进程的输出里的结束位置，后端重启后据此接着记，不重复；
// parent 是子 agent 的条目所属的那次工具调用
type Produced = { offset?: number; parent?: string }

// 发给页面时过长的命令只留开头、输出只留末尾，clipped 表示省略过，完整的按调用的位置另外读。只在发给页面的条目上
type Clippable = { clipped?: true }

// 事件携带的语义记录。持久化、对象身份和批次边界由 journal/store 管理。
// 一轮从 mode 为 start 的 input 开始，到 turn_end 结束；中间的 input 是回答中途插的话（interrupt：先打断了正在做的事）
export type Entry =
  // 第一条：session 用哪个 agent、属于哪个 app、在哪个目录里干活、追加的系统提示、以喜多的身份时读写哪些记忆
  | { type: 'session'; time: string; agent: AgentId; owner: string; cwd: string; instructions?: string; identity?: IdentityScope }
  // model、effort：开始这一轮时选的，没有是 agent 的默认
  | {
      type: 'input'
      time: string
      mode: 'start' | 'steer' | 'interrupt'
      text: string
      attachments?: Attachment[]
      model?: string
      effort?: string
    }
  // agent 那边的会话建立了，agent 进程重新启动时接着这个会话
  | ({ type: 'agent_session'; time: string; id: string } & Produced)
  // 思考的摘要；durationMs 是想了多久，不知道开始时间（后端重启时正在想）就没有
  | ({ type: 'thinking'; time: string; text: string; durationMs?: number } & Produced)
  // files：文字里引用的本机文件（原样的路径）对应的快照，在 files/ 里
  | ({ type: 'text'; time: string; text: string; files?: Record<string, string> } & Produced)
  // name 是 agent 自己的工具名；tool 不足以显示全部参数时（mcp、browser、other，没有 change 的 edit）带着原始的 input
  | ({ type: 'tool_call'; time: string; id: string; name: string; tool: ToolDetail; input?: unknown; background?: true } & Clippable & Produced)
  // output 是结果文字的末尾一段，truncated 表示前面还有被省略的；images 是结果里的图片，在 files/ 里
  | ({
      type: 'tool_result'
      time: string
      callId: string
      status: 'done' | 'error'
      output?: string
      truncated?: true
      images?: string[]
    } & Clippable & Produced)
  // 上下文被压缩了：手动还是自动，压缩前后各多少 token
  | ({ type: 'compact'; time: string; trigger: string; preTokens?: number; postTokens?: number } & Produced)
  // outputTokens 含子 agent 的；context 是结束时的上下文大小；usage 是 agent 会话到这时为止按模型累计的用量。
  // offset 是这一轮结束时读到的输出位置
  | {
      type: 'turn_end'
      time: string
      durationMs: number
      outcome?: 'stopped' | 'error'
      error?: string
      model?: string
      outputTokens?: number
      context?: Context
      usage?: Record<string, Tokens>
      offset?: number
    }

// 回答进行中不成为条目的临时内容：当前在做什么
export type Status =
  | { type: 'requesting' }
  | { type: 'thinking' }
  | { type: 'tool'; name: string }
  | { type: 'compacting' }
  | { type: 'retrying'; attempt: number }
  // 答完了，等后台任务结束后接着答
  | { type: 'waiting'; tasks: number }

// 子 agent 或后台任务正在做的一步，以及到目前为止调用了几次工具、用了多少 token
export type TaskProgress = { activity?: string; toolUses?: number; tokens?: number }

// 正在想的那段思考、正在写的那段文字，记成条目后清空；tasks 按对应的工具调用 id；
// files 是正在写的文字引用的本机文件的快照
export type Live = {
  thinking: string
  text: string
  status: Status | null
  tasks: Record<string, TaskProgress>
  files: Record<string, string>
}

// 临时内容的变化
export type LiveEvent =
  | { type: 'thinking'; text: string }
  | { type: 'text'; text: string }
  | { type: 'status'; status: Status | null }
  | { type: 'task'; callId: string; progress: TaskProgress | null }
  | { type: 'file'; path: string; name: string }

// 订阅 session 收到的：event 是新记下的一条；live 是订阅时（以及一轮开始和结束时）的临时内容，null 表示没在回答；
// 其余是临时内容的变化。记成条目的思考和文字取代对应的临时内容。
// window：第一次订阅（只要最后几轮）时最先收到，events 从一轮的开头起，第一条的 seq 大于 1 时前面还有更早的，session 是第一条条目；
// events：断线续传时补发的，一次发完
export type KitaSessionEvent =
  | { type: 'event'; event: PageEvent }
  | { type: 'events'; events: PageEvent[] }
  | { type: 'live'; live: Live | null }
  | { type: 'window'; session: Extract<Entry, { type: 'session' }>; events: PageEvent[] }
  | LiveEvent

// idle：没在回答；running：正在回答；waiting：答完了，在等后台任务
export type KitaSessionState = 'idle' | 'running' | 'waiting'

// app 看到的 session 的概况。model、effort 是最近一轮的；usage 是一共用掉的 token，按模型；
// costs 是每一轮按 API 价格折算的花费（美元）和这一轮结束的时间，只有能折算的 agent 有
export type KitaSessionSummary = {
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
  effort?: string
  usage: Record<string, Tokens>
  costs: [time: string, cost: number][]
}

// 订阅额度的一个窗口：id 是 agent 自己的标识，minutes 是窗口多长，用了多少（0 到 1），什么时候重置（秒级时间戳）；
// label：一样长的窗口不止一个时用来区分
export type QuotaWindow = { id: string; minutes: number; label?: string; utilization: number; resetsAt: number }
// 一个 agent 的订阅额度：limited 是已被限流。agent 运行时报告，按 agent 存在 agent 服务的数据目录里（见 limits.ts）
export type Limits = { limited: boolean; windows: QuotaWindow[]; updatedAt: string }

// Claude 的两份登录：完整登录（/login，续期令牌约 4 周后到期，过了只能重新登录）和备用的一年期 token
// （setup-token 生成，只能调模型，没有 claude.ai 的连接器）。mode 是现在启动 Claude 用哪份，none 是都用不了。
// broken：完整登录没到期就在回答时认证失败了。每次读取时从钥匙串现查
export type ClaudeAuth = {
  mode: 'login' | 'token' | 'none'
  login?: { expiresAt?: string; broken?: true }
  backup?: { expiresAt?: string }
}

// Codex 的 ChatGPT 登录：访问令牌由 Codex 自己续，没有备用的。broken：回答时认证失败了，重新登录后不算。每次读取时从登录文件现查
export type CodexAuth = { loggedIn: boolean; broken?: true }

// 各个 agent 登录的状况，各家的登录方式不同，形状也不同，页面上由各自的组件显示
export type AgentAuths = { claude: ClaudeAuth; codex: CodexAuth }

// 页面看到的 agent 的状况：各 agent 最近报告的额度和登录。有变化时后端发 agent 通知，页面重新读取
export type AgentStatus = { limits: Partial<Record<AgentId, Limits>>; auth: Partial<AgentAuths> }

// 账号的一项信息，各家独有的（比如组织、额度重置次数）都用它，页面逐行原样显示
export type AccountDetail = { label: string; value: string; note?: string }

// 系统 app 里 agent 的详细信息，每次打开时现查。没装、没登录或读不到的项没有
export type AgentAccount = {
  agent: AgentId
  version?: string
  loggedIn: boolean
  email?: string
  // 订阅的套餐，原样显示
  plan?: string
  // 访问令牌什么时候过期、上次续期的时间，有刷新令牌时到期前会自动续；令牌的到期不是要看的（比如会自动频繁续期）时没有
  token?: { expiresAt?: string; refreshedAt?: string; refreshable: boolean }
  details: AccountDetail[]
  // 登录和配置存放的目录
  configDir: string
  // 正在回答的 session 数，不分是哪个 app 的
  running: number
}

// session 以喜多的身份对话：带上用户写的喜多的描述和照片，读 read 里这些范围的记忆，新的记忆记到 write 范围。
// 没有它的 session（Code、临时对话）不带身份，也读写不了记忆。范围是 personal（个人）或某个 app 的 id
export type IdentityScope = { read: string[]; write: string }

// stated：用户说过或确认过的；inferred：agent 从交流中推测的，用户确认前不能当作事实
export type MemoryKind = 'stated' | 'inferred'

// 谁写的：用户在页面上，或者某个 app 的 session 里的 agent
export type MemorySource = { type: 'user' } | { type: 'session'; owner: string; session: string }

// 新记一条记忆、改一条记忆的请求体。session：agent 在哪个 session 里记的，页面上的用户不带；scope 只有用户能指定，默认是个人
export type NewMemory = { session?: string; text: string; kind?: MemoryKind; scope?: string }
export type MemoryChange = { session?: string; text?: string; kind?: MemoryKind }

// 一条长期记忆；history 是改动前的各个版本，从旧到新，可以恢复
export type Memory = {
  id: string
  text: string
  kind: MemoryKind
  scope: string
  source: MemorySource
  createdAt: string
  updatedAt: string
  history: { text: string; kind: MemoryKind; time: string; source: MemorySource }[]
}

// 喜多的照片：file 是 identity/photos/ 里的文件名
export type Photo = { file: string; addedAt: string }

// 用户写的喜多：description 是喜多的样子、性格和相处方式，空表示还没写；avatar 是用作头像的照片
export type Profile = { description: string; photos: Photo[]; avatar?: string }

// 不在回答中的 session 不在里面
export type Activity = { session: string; owner: string; state: Exclude<KitaSessionState, 'idle'>; since: string }
