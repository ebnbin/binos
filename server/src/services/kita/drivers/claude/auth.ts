import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { kitaServiceDir, agentsDir } from '../../../../paths.js'
import { notifyChange } from '../../../../events.js'
import type { AgentAttention, ClaudeAuth } from '../../types.js'

// 启动 Claude 时用哪份登录（两份见 ClaudeAuth）：平时用完整登录；它快过期、读不出来或者认证失败过时，
// 换成备用的一年期 token（环境变量 CLAUDE_CODE_OAUTH_TOKEN 优先于钥匙串里的登录），重新登录后自动换回来。
// 两份都在钥匙串里，令牌不落盘

export const configDir = path.join(agentsDir, 'claude')

// 配置目录不是默认的时，Claude Code 把登录存在钥匙串里以目录路径的哈希区分的一项
const loginItem = `Claude Code-credentials-${createHash('sha256').update(configDir).digest('hex').slice(0, 8)}`
// 备用 token 的那一项，备注里记着到期时间
const tokenItem = 'binOS Claude token'
// 认证失败过的完整登录：记的是续期令牌的指纹，重新登录后令牌变了就不算了
const brokenPath = path.join(kitaServiceDir, 'claude-login-broken')

// 完整登录离过期不到这么久就换成备用 token：一轮回答可能跑好几个小时，中途过期这一轮就断了
const switchMargin = 6 * 3600_000

export type Login = { accessToken: string; refreshToken?: string; expiresAt?: number; refreshTokenExpiresAt?: number; subscriptionType?: string }

function security(args: string[]): string | undefined {
  try {
    return execFileSync('/usr/bin/security', args, { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return undefined
  }
}

export function readLogin(): Login | undefined {
  try {
    return JSON.parse(security(['find-generic-password', '-s', loginItem, '-w']) ?? '').claudeAiOauth
  } catch {
    return undefined
  }
}

function readToken(): Token | undefined {
  const token = security(['find-generic-password', '-s', tokenItem, '-w'])
  if (!token) {
    return undefined
  }
  const comment = /"icmt"<blob>="([^"]*)"/.exec(security(['find-generic-password', '-s', tokenItem]) ?? '')?.[1]
  const expiresAt = comment ? Date.parse(comment) : NaN
  return { token, ...(!Number.isNaN(expiresAt) && { expiresAt }) }
}

const fingerprint = (login: Login) => createHash('sha256').update(login.refreshToken ?? login.accessToken).digest('hex').slice(0, 16)

function isBroken(login: Login) {
  try {
    return readFileSync(brokenPath, 'utf8').trim() === fingerprint(login)
  } catch {
    return false
  }
}

const iso = (time: number | undefined) => (time ? new Date(time).toISOString() : undefined)

type Token = { token: string; expiresAt?: number }

// 该用哪份登录：完整登录离过期还远就用它；否则有能用的备用 token 就换成它；都不行时完整登录能用一刻是一刻
export function chooseAuth(login: Login | undefined, token: Token | undefined, broken: boolean, now: number): ClaudeAuth {
  const loginValid = (margin: number) => login && !broken && (!login.refreshTokenExpiresAt || login.refreshTokenExpiresAt > now + margin)
  const tokenUsable = token && (!token.expiresAt || token.expiresAt > now)
  const mode = loginValid(switchMargin) ? 'login' : tokenUsable ? 'token' : loginValid(0) ? 'login' : 'none'
  const loginExpiresAt = iso(login?.refreshTokenExpiresAt)
  const tokenExpiresAt = iso(token?.expiresAt)
  return {
    mode,
    ...(login && { login: { ...(loginExpiresAt && { expiresAt: loginExpiresAt }), ...(broken && { broken: true as const }) } }),
    ...(token && { backup: { ...(tokenExpiresAt && { expiresAt: tokenExpiresAt }) } }),
  }
}

// 现在该用哪份，以及要加的环境变量
function decide(): { auth: ClaudeAuth; env: Record<string, string> } {
  const login = readLogin()
  const token = readToken()
  const auth = chooseAuth(login, token, Boolean(login && isBroken(login)), Date.now())
  return { auth, env: auth.mode === 'token' ? { CLAUDE_CODE_OAUTH_TOKEN: token!.token } : {} }
}

// 上次看到的状况：变了就通知页面重新读取（比如快到期了自动换成备用 token）
let lastSeen: string | undefined

function seen(auth: ClaudeAuth) {
  const text = JSON.stringify(auth)
  if (lastSeen !== undefined && text !== lastSeen) {
    notifyChange({ type: 'agent' })
  }
  lastSeen = text
}

export function claudeAuth(): ClaudeAuth {
  const { auth } = decide()
  seen(auth)
  return auth
}

// 启动 Claude 时要加的环境变量。每次启动时决定，换登录不用重启后端
export function claudeAuthEnv(): Record<string, string> {
  const { auth, env } = decide()
  seen(auth)
  return env
}

// 回答时请求被拒绝（401）：用的是完整登录就记下它失效了，之后换成备用 token。返回给用户看的原因
export function claudeAuthFailed(): string {
  const before = decide()
  const login = readLogin()
  if (before.auth.mode === 'login' && login) {
    mkdirSync(path.dirname(brokenPath), { recursive: true })
    writeFileSync(brokenPath, fingerprint(login))
  }
  const after = claudeAuth()
  if (before.auth.mode === 'login' && after.mode === 'token') {
    return 'Claude 的登录失效了，已经换成备用 token，重新发送就能接着答。去「系统」→ Agent 重新登录后会自动换回来'
  }
  return before.auth.mode === 'token'
    ? 'Claude 的备用 token 失效了，去「系统」→ Agent 重新登录或更新备用 token'
    : 'Claude 的登录失效了，去「系统」→ Agent 重新登录'
}

// 存下新的备用 token：一年有效，到期时间记在备注里。经 security -i 从标准输入交给它，令牌不出现在命令行参数里
export function storeToken(token: string) {
  if (!/^[\w-]+$/.test(token)) {
    throw new Error('令牌的格式不对')
  }
  const expiresAt = new Date(Date.now() + 365 * 86_400_000).toISOString().replace(/\.\d+Z$/, 'Z')
  execFileSync('/usr/bin/security', ['-i'], {
    input: `add-generic-password -U -s "${tokenItem}" -a binos -j "${expiresAt}" -w "${token}"\n`,
    timeout: 5000,
    stdio: ['pipe', 'ignore', 'pipe'],
  })
  claudeAuth()
}

const day = 86_400_000
// 完整登录剩不到这么久时提醒重新登录，备用 token 剩不到这么久时提醒更新
const loginWarning = 7 * day
const backupWarning = 30 * day

// 登录要处理的事。changesAt：最近的一个会让结果或正在用的登录变化的时间
export function claudeAttention(auth: ClaudeAuth, now: number): { attention?: AgentAttention; changesAt?: number } {
  const loginExpiry = auth.login?.expiresAt ? Date.parse(auth.login.expiresAt) : undefined
  const backupExpiry = auth.backup?.expiresAt ? Date.parse(auth.backup.expiresAt) : undefined
  const changes = [
    ...(loginExpiry ? [loginExpiry - loginWarning, loginExpiry - switchMargin, loginExpiry] : []),
    ...(backupExpiry ? [backupExpiry - backupWarning, backupExpiry] : []),
  ].filter((time) => time > now)
  const changesAt = changes.length ? Math.min(...changes) : undefined
  const attention = ((): AgentAttention | undefined => {
    if (auth.mode === 'none') return { reason: 'logged-out', usable: false }
    if (auth.mode === 'token') return { reason: auth.login?.broken ? 'login-broken' : 'login-expired', usable: true }
    if (loginExpiry && loginExpiry - now < loginWarning) return { reason: 'login-expiring', usable: true, expiresAt: auth.login!.expiresAt }
    if (backupExpiry && backupExpiry - now < backupWarning) return { reason: 'backup-expiring', usable: true, expiresAt: auth.backup!.expiresAt }
  })()
  return { ...(attention && { attention }), ...(changesAt && { changesAt }) }
}
