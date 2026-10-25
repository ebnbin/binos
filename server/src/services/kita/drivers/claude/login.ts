import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { agentEnv } from '../index.js'
import { killTerminal, openTerminal, waitFor } from '../../pty.js'
import type { Terminal } from '../../pty.js'
import { claudeAuth, storeToken } from './auth.js'

// 在网页上登录 Claude（见 auth.ts 的两份登录）：
// - login：重新完整登录，对 binOS 的 Claude 配置目录跑 `claude auth login`，它自己把登录存进钥匙串
// - token：生成备用的一年期 token，在一个空的配置目录里跑 `claude setup-token`（不碰现有的登录），把它给出的令牌存进钥匙串
// 两者都给出授权链接，用户在自己的浏览器里授权（哪台设备都行，授权后的页面直接显示代码），把代码贴回网页交给它。
// 这些命令是交互式的，在伪终端里跑（见 ../pty.ts）

export type ClaudeLoginKind = 'login' | 'token'

type Login = Terminal & {
  kind: ClaudeLoginKind
  // token 用的空配置目录，结束时删掉
  tempDir?: string
  finishing?: boolean
  timer: NodeJS.Timeout
}

const logins = new Map<string, Login>()

// 用户迟迟不贴代码，十分钟后放弃
const loginTimeout = 10 * 60_000

// 终端的控制序列（CSI），比如移动光标
const csi = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[A-Za-z]`, 'g')

// 去掉终端的控制序列只留文字。它的界面用移动光标把字隔开，移动光标换成空格，不然字会连在一起
const plain = (text: string) => stripVTControlCharacters(text.replace(csi, ' ')).replace(/[ \t]+/g, ' ')

const authorizeUrl = (output: string) => /https:\/\/\S+\/oauth\/authorize\?\S+/.exec(plain(output))?.[0]

// 成功时先打一行「Long-lived authentication token created successfully!」，接着是令牌，再是「Store this token securely」。
// 令牌在它的界面里会被折成几行，所以取两句之间从 sk-ant- 开始的部分，去掉换行、缩进和边框再拼起来；第二句出来了才算完整
export function findToken(text: string): string | undefined {
  const start = text.search(/created successfully/i)
  const end = start < 0 ? -1 : text.indexOf('Store this token', start)
  if (end < 0) {
    return undefined
  }
  const segment = text.slice(start, end)
  const at = segment.indexOf('sk-ant-')
  const token = at < 0 ? '' : segment.slice(at).replace(/[^\w-]/g, '')
  return /^sk-ant-[\w-]{60,}$/.test(token) ? token : undefined
}

// 出错时给用户看的话里不能带出令牌：令牌出现之后的不要，剩下的里像令牌的长串也遮掉
export function redact(text: string) {
  const start = text.search(/created successfully/i)
  return (start < 0 ? text : text.slice(0, start)).replace(/[\w-]{24,}/g, '…')
}

// 失败时它打出来的那句
const failure = /(?:OAuth error|Login failed|Invalid code|error)[^\n]*/i

// 出错时给用户看的：它最后说的几句
function lastWords(login: Login, from: number) {
  return redact(plain(login.output.slice(from)))
    .replace(/[✢✳✶✻✽·*]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(-200)
}

function end(id: string) {
  const login = logins.get(id)
  if (!login) {
    return
  }
  logins.delete(id)
  clearTimeout(login.timer)
  killTerminal(login)
  if (login.tempDir) {
    rmSync(login.tempDir, { recursive: true, force: true })
  }
}

export type ClaudeLoginStart = { id: string; url: string }

// 开始登录：返回这次登录的编号和授权链接
export async function startClaudeLogin(kind: ClaudeLoginKind): Promise<ClaudeLoginStart> {
  const id = randomUUID()
  const tempDir = kind === 'token' ? mkdtempSync(path.join(tmpdir(), 'binos-claude-token-')) : undefined
  const command = kind === 'login' ? ['claude', 'auth', 'login'] : ['claude', 'setup-token']
  // 不在这台 Mac 上打开浏览器，链接交给网页
  const env = { ...agentEnv('claude'), ...(tempDir && { CLAUDE_CONFIG_DIR: tempDir }), BROWSER: '/usr/bin/true' }
  const login: Login = Object.assign(openTerminal(command, env), { kind, tempDir, timer: setTimeout(() => end(id), loginTimeout) })
  logins.set(id, login)
  const url = await waitFor(login, authorizeUrl, 30_000)
  if (!url) {
    const tail = lastWords(login, 0)
    end(id)
    throw new Error(`没拿到授权链接${tail ? `：${tail}` : ''}`)
  }
  return { id, url }
}

// 用户贴回授权后的代码，完成这次登录
export async function finishClaudeLogin(id: string, code: string): Promise<void> {
  const login = logins.get(id)
  if (!login) {
    throw new Error('这次登录已经失效，重新开始')
  }
  if (login.finishing) {
    throw new Error('正在处理，稍等')
  }
  login.finishing = true
  try {
    const from = login.output.length
    // 代码和回车分两次写：一次写进去的一长串会被当成粘贴，里面的回车也成了文字，不会提交
    login.child.stdin.write(code.trim())
    await new Promise((resolve) => setTimeout(resolve, 500))
    login.child.stdin.write('\r')
    if (login.kind === 'login') {
      // 登录由它自己存进钥匙串，成功了就正常退出
      const exited = await waitFor(login, () => (login.exitCode !== undefined ? true : undefined), 90_000)
      if (!exited || login.exitCode !== 0 || failure.test(plain(login.output.slice(from)))) {
        throw new Error(`登录没成功，claude 最后说：「${lastWords(login, from) || '（什么都没说）'}」。重新开始`)
      }
      claudeAuth()
    } else {
      const result = await waitFor(
        login,
        (output) => {
          const text = plain(output.slice(from))
          const token = findToken(text)
          if (token) {
            return { token }
          }
          const error = failure.exec(text)?.[0]
          return error && (/Press Enter/i.test(text) || login.exitCode !== undefined) ? { error } : undefined
        },
        90_000,
      )
      if (!result || 'error' in result) {
        // 已经给出了令牌、只是没认出来时，不复述它说的话，免得带出令牌的一部分
        const shown = /created successfully/i.test(plain(login.output.slice(from)))
        throw new Error(shown ? '令牌生成了，但没能从输出里认出来。重新开始' : `没拿到令牌，claude 最后说：「${lastWords(login, from) || '（什么都没说）'}」。重新开始`)
      }
      storeToken(result.token)
    }
  } finally {
    end(id)
  }
}

export function cancelClaudeLogin(id: string) {
  end(id)
}
