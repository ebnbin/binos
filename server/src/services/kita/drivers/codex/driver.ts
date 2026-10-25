import path from 'node:path'
import { commandOutput, isoFromSeconds, parseJson, readText } from '../../cli.js'
import { saveLimits } from '../../limits.js'
import type { CodexAuth } from '../../types.js'
import type { Driver } from '../types.js'
import { askCodex, codexCatalog, codexLimits } from './app-server.js'
import type { RateLimits } from './app-server.js'
import { codexApi } from './api.js'
import { codexAuth, codexAuthFailed, configDir } from './auth.js'
import { CodexDecoder } from './decoder.js'
import type { CodexHostArgs } from './host.js'

export const codex: Driver = {
  id: 'codex',
  command: 'codex',
  configDir,
  env: { CODEX_HOME: configDir },
  inheritedEnv: /^(CODEX|OPENAI)/,
  host: ({ agentSession, model, effort, instructions }) => ({
    agent: 'codex',
    args: { thread: agentSession, model, effort, instructions } satisfies CodexHostArgs,
  }),
  decoder: (options) => new CodexDecoder(options),
  fileHint: '自己查看，图片用 view_image 工具',
  // 不指定模型时能选的是默认模型的思考程度。顺便更新额度
  catalog: async (env) => {
    const { limits, ...catalog } = await codexCatalog(env)
    if (limits) {
      saveLimits('codex', limits)
    }
    return { ...catalog, efforts: catalog.models.find((model) => model.isDefault)?.efforts ?? [] }
  },
  account,
  auth: codexAuth,
  // 只在回答时认证失败过才要处理：没登录过 Codex 也照样能用别的 agent
  attention: (auth) => ((auth as CodexAuth).broken ? { attention: { reason: 'login-broken', usable: false } } : {}),
  // gpt-6.1-sol → GPT-6.1-Sol
  modelName: (model) => (model.startsWith('gpt-') ? model.split('-').map((part, i) => (i === 0 ? 'GPT' : part[0].toUpperCase() + part.slice(1))).join('-') : undefined),
  api: codexApi,
  authFailed: codexAuthFailed,
}

const dateTime = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

type LoginFile = { tokens?: { access_token?: string; refresh_token?: string }; last_refresh?: string }
type ResetCredit = { status: string; expiresAt: number | null }

// 访问令牌是 JWT，过期时间直接从里面读，不校验签名
async function account(env: NodeJS.ProcessEnv) {
  const [version, live] = await Promise.all([
    commandOutput('codex', ['--version'], env),
    askCodex(
      env,
      async (request) => {
        const [account, limits] = await Promise.all([
          request<{ account: { email?: string; planType?: string } | null }>('account/read', {}),
          request<{ rateLimits?: RateLimits; rateLimitResetCredits?: { credits: ResetCredit[] } | null }>('account/rateLimits/read', {}),
        ])
        return { account: account?.account ?? undefined, limits }
      },
      { account: undefined, limits: undefined },
    ),
  ])
  const snapshot = live.limits?.rateLimits && codexLimits(live.limits.rateLimits, new Date().toISOString())
  if (snapshot) {
    saveLimits('codex', snapshot)
  }
  const auth = parseJson<LoginFile>(readText(path.join(configDir, 'auth.json')))
  const expiresAt = isoFromSeconds(jwtClaims(auth?.tokens?.access_token)?.exp)
  const credits = (live.limits?.rateLimitResetCredits?.credits ?? []).filter((credit) => credit.status === 'available')
  const firstExpiry = Math.min(...credits.flatMap((credit) => (credit.expiresAt ? [credit.expiresAt] : [])))
  return {
    ...(version && { version: version.replace(/^codex-cli\s*/, '') }),
    loggedIn: live.account !== undefined,
    ...(live.account?.email && { email: live.account.email }),
    ...(live.account?.planType && { plan: live.account.planType }),
    ...(auth?.tokens && {
      token: {
        ...(expiresAt && { expiresAt }),
        ...(auth.last_refresh && { refreshedAt: auth.last_refresh }),
        refreshable: Boolean(auth.tokens.refresh_token),
      },
    }),
    details:
      credits.length > 0
        ? [
            {
              label: '额度重置',
              value: `还能重置 ${credits.length} 次`,
              ...(Number.isFinite(firstExpiry) && { note: `最早一次 ${dateTime.format(new Date(firstExpiry * 1000))} 过期` }),
            },
          ]
        : [],
    configDir,
  }
}

function jwtClaims(token: string | undefined): { exp?: number } | undefined {
  return parseJson(token ? Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8') : undefined)
}
