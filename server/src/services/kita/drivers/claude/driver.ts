import { randomUUID } from 'node:crypto'
import { commandOutput, parseJson } from '../../cli.js'
import type { Driver } from '../types.js'
import { claudeApi } from './api.js'
import { claudeAttention, claudeAuth, claudeAuthEnv, claudeAuthFailed, configDir, readLogin } from './auth.js'
import { claudeModelName, claudeResult } from './tools.js'
import type { ClaudeAuth } from '../../types.js'
import { claudeModels } from './catalog.js'
import { ClaudeDecoder } from './decoder.js'
import { tokenCost } from './prices.js'

const efforts = ['low', 'medium', 'high', 'xhigh', 'max']

type AuthStatus = { loggedIn?: boolean; email?: string; orgName?: string; subscriptionType?: string }
const authStatus = async (env: NodeJS.ProcessEnv) => parseJson<AuthStatus>(await commandOutput('claude', ['auth', 'status', '--json'], env))

export const claude: Driver = {
  id: 'claude',
  command: 'claude',
  configDir,
  env: { CLAUDE_CONFIG_DIR: configDir },
  inheritedEnv: /^(CLAUDE|ANTHROPIC)/,
  host: ({ agentSession, model, effort, instructions }) => ({
    agent: 'claude',
    args: [
      'claude',
      '-p',
      '--input-format', 'stream-json',
      '--permission-mode', 'bypassPermissions',
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--include-hook-events',
      '--replay-user-messages',
      // 思考默认只给加密的原文，要这个才给出能显示的摘要
      '--thinking-display', 'summarized',
      // 子 agent 的文字和思考也转发出来，带着 parent_tool_use_id
      '--forward-subagent-text',
      '--chrome',
      '--append-system-prompt', instructions,
      ...(model ? ['--model', model] : []),
      ...(effort ? ['--effort', effort] : []),
      ...(agentSession ? ['--resume', agentSession] : ['--session-id', randomUUID()]),
    ],
  }),
  decoder: (options) => new ClaudeDecoder(options),
  fileHint: '用 Read 工具查看',
  efforts,
  catalog: async (env) => {
    const [auth, models] = await Promise.all([authStatus(env), claudeModels(env)])
    return { available: auth?.loggedIn === true, models, efforts: models.find((model) => model.isDefault)?.efforts ?? [] }
  },
  account,
  auth: claudeAuth,
  attention: (auth, now) => claudeAttention(auth as ClaudeAuth, now),
  modelName: claudeModelName,
  result: claudeResult,
  api: claudeApi,
  authEnv: claudeAuthEnv,
  authFailed: claudeAuthFailed,
  cost: tokenCost,
}

// 访问令牌几个小时就自动续一次，要看的是完整登录的到期时间（在登录的状况里），不给 token
async function account(env: NodeJS.ProcessEnv) {
  const [version, auth] = await Promise.all([commandOutput('claude', ['--version'], env), authStatus(env)])
  const plan = auth?.subscriptionType ?? readLogin()?.subscriptionType
  return {
    ...(version && { version: version.replace(/\s*\(Claude Code\)$/, '') }),
    loggedIn: auth?.loggedIn === true,
    ...(auth?.email && { email: auth.email }),
    ...(plan && { plan }),
    details: auth?.orgName ? [{ label: '组织', value: auth.orgName }] : [],
    configDir,
  }
}
