import type { AgentId, Context, Tokens } from '../../services/kita/types.js'

// 新建 session 和发消息的请求体，各项的含义见 api.ts 里的 messageBody
export type MessageBody = { project?: string; text: string; attachments?: Upload[]; interrupt?: boolean; queue?: boolean; agent?: AgentId; model?: string; effort?: string }
// 新建项目、给项目关联仓库的请求体：repository 是 owner/name，create 是在 GitHub 上新建它
export type RepositoryBody = { name: string; repository: string; create?: boolean }
// 改名、置顶、归档，没给的项不动
export type SessionEdit = { title?: string; pinned?: boolean; archived?: boolean }

// 用户上传、还没随消息发出的附件。file 是 uploads/ 里的文件名，name 是原来的文件名
export type Upload = { file: string; name: string }

// 排着队、等这一轮答完再发的消息。model、effort 是排队时选的，开始新的一轮时用
export type QueuedMessage = { id: string; time: string; text: string; attachments?: Upload[]; model?: string; effort?: string }

// session 里开的 PR；state、title 查到了才有，preview 是开着的 binOS 自己的 PR 正在运行的预览
export type PullRequest = { url: string; number: number; state?: 'open' | 'merged' | 'closed'; title?: string; preview?: string }

// 一个 session 是和 agent 的一段对话，内容在 agent 服务的 thread 里
export type Project = { id: string; name: string; repository?: string; defaultBranch?: string }

export type SessionSummary = {
  project: string
  id: number
  kitaSession: string
  // 改过名就是改的名字；否则是第一条用户消息，没写字时是第一个附件的文件名
  title: string
  updatedAt: string
  // running：正在回答；waiting：答完了，在等后台任务
  running: boolean
  waiting: boolean
  // 最近一轮答完之后还没看过
  unread: boolean
  outcome?: 'stopped' | 'error'
  pinned: boolean
  archived: boolean
  context?: Context
  agent: AgentId
  // 最近一轮用的模型和思考程度
  model?: string
  effort?: string
  // 开始过几轮
  turns: number
  // 一共用掉的 token；priced：agent 能按 API 价格折算花费，才估得出大约占订阅周额度多少（quota，0 到 1，见 usage.ts）
  tokens?: Tokens
  priced: boolean
  quota?: number
  prs: PullRequest[]
  queue: QueuedMessage[]
}

// 当前这个 7 天窗口（resetsAt 时重置）里 binOS 用能折算花费的 agent 大约用了它周额度的多少（0 到 1），估不出来时没有 week。
// 窗口是整个订阅共用的，其余的是别处用的（见 usage.ts）。每次读取时现算
export type CodeUsage = { resetsAt: number; week?: number }

// 新建 session 或发出消息后：kitaSession 是页面显示对话内容用的
export type SessionRef = { id: number; kitaSession: string }

// 搜索命中的一处：item 是命中的条目在对话里的位置，标题命中时没有；before、match、after 是命中处和前后的文字
export type SearchResult = { id: number; title: string; archived: boolean; item?: number; kind: 'title' | 'input' | 'text'; before: string; match: string; after: string }
// results 最多 200 条，total 是一共命中多少处
export type SearchResults = { results: SearchResult[]; total: number }
