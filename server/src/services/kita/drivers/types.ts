import type { Hono } from 'hono'
import type { HostAgent } from '../host/protocol.js'
import type { AgentAccount, AgentAttention, AgentAuths, AgentCatalog, AgentId, Entry, Limits, Live, LiveEvent, Tokens, ToolDetail } from '../types.js'

// agentSession：接着 agent 那边的这个会话，没有就开一个新的；model、effort 没有时用 agent 自己的默认；instructions：追加的系统提示
export type Launch = { agentSession?: string; model?: string; effort?: string; instructions: string }

// filesDir：工具结果里的图片存在这里；agentSession：接着的 agent 会话
export type DecoderOptions = { filesDir: string; agentSession: string | undefined }

// 解码器产出的条目：agent 进程输出的内容，不含 thread 自己记的 thread、input
export type DecodedItem = Exclude<Entry, { type: 'session' | 'input' }>

export type ToolResultEntry = Extract<Entry, { type: 'tool_result' }>

// 把 agent 进程的原始输出逐行转成条目和临时内容的变化，跨越 agent 进程里的多轮。
// answered 是这一轮答完了、之后还没有新的动静：插的话会让它接着答，没人插话这一轮就结束了
export interface Decoder {
  answered: boolean
  // 主对话里还在后台运行、没有结束的工具调用
  backgroundTasks(): number
  current(): Omit<Live, 'files'>
  // offset 是这一行在输出文件里的结束位置；limits 是这一行报告的订阅额度；authFailed：请求因为登录无效被拒绝了
  push(text: string, offset: number): { items: DecodedItem[]; events: LiveEvent[]; limits?: Limits; authFailed?: true }
  // 一轮结束：还没想完的思考、还没写完的文字照样记下，没有结果的工具调用记成出错，最后是 turn_end。之后从新的一轮算起
  endTurn(options: { startedAt: string; stopped: boolean; error?: string }): DecodedItem[]
}

// 一种 agent 的接入：怎么启动、怎么读它的输出、怎么查账号
export type Driver = {
  id: AgentId
  // agent 的命令，它换了版本时重新启动 agent 进程
  command: string
  // 登录和配置所在的目录，env 让 agent 和它的命令行工具用这个目录
  configDir: string
  env: Record<string, string>
  // 后端可能是从某个 agent 里启动的（比如测试实例），这些环境变量不能继承给任何 agent
  inheritedEnv: RegExp
  // agent 进程由 host 进程持有：host 用哪个 host agent、给它什么参数
  host(launch: Launch): { agent: HostAgent; args: unknown }
  decoder(options: DecoderOptions): Decoder
  // 消息里怎么让它查看本机的文件
  fileHint: string
  // 能选的模型和思考程度，不在里面的不传给它；没有时由 agent 自己判断
  models?: readonly string[]
  efforts?: readonly string[]
  // env 是 agentEnv 给的；能选的模型列表现查时由它自己缓存
  catalog(env: NodeJS.ProcessEnv): Promise<Omit<AgentCatalog, 'agent'>>
  account(env: NodeJS.ProcessEnv): Promise<Omit<AgentAccount, 'agent' | 'running'>>
  // 登录的状况，每次读取时现查，变了就通知页面
  auth(): AgentAuths[AgentId]
  // 登录要用户处理的事；changesAt 是到了这个时间（毫秒时间戳）结果会变，比如该提醒快到期了
  attention(auth: AgentAuths[AgentId], now: number): { attention?: AgentAttention; changesAt?: number }
  // 模型的显示名，认不出时没有
  modelName?(model: string): string | undefined
  // 从工具结果的文字里认出的结构（tool_result 的 startLine、links 和对应的 output），认不出时没有
  result?(tool: ToolDetail, result: ToolResultEntry): Partial<ToolResultEntry> | undefined
  // 这个 agent 自己的接口（比如在网页上登录），挂在 /api/kita/<id> 下
  api: Hono<any, any, any>
  // 启动时另加的环境变量，每次启动时现定（比如换用哪份登录）
  authEnv?(): Record<string, string>
  // 回答时请求被拒绝（登录无效）：处理后返回给用户看的原因，这一轮以它出错结束
  authFailed?(): string
  // 按 API 价格折算的花费（美元）
  cost?(model: string, tokens: Tokens): number
}
