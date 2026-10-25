import { randomUUID } from 'node:crypto'
import { stripVTControlCharacters } from 'node:util'
import { agentEnv } from '../index.js'
import { killTerminal, openTerminal, waitFor } from '../../pty.js'
import type { Terminal } from '../../pty.js'
import { codexAuth } from './auth.js'

// 在网页上重新登录 Codex：对 binOS 的 Codex 配置目录跑 `codex login --device-auth`（设备码登录），
// 它给出网址和一次性的码，用户在自己的设备上打开网址、输入码授权；授权后它自己写好登录并退出，不用贴回什么。
// 码 15 分钟内有效，过了就放弃。ChatGPT 账号要在安全设置里允许设备码登录

type Login = Terminal & { timer: NodeJS.Timeout }

const logins = new Map<string, Login>()

const loginTimeout = 15 * 60_000

const plain = (text: string) => stripVTControlCharacters(text)

function end(id: string) {
  const login = logins.get(id)
  if (!login) {
    return
  }
  logins.delete(id)
  clearTimeout(login.timer)
  killTerminal(login)
}

export type CodexLoginStart = { id: string; url: string; code: string }
export type CodexLoginStatus = { status: 'waiting' | 'done' } | { status: 'failed'; error: string }

// 开始登录：返回这次登录的编号、要打开的网址和要输入的码
export async function startCodexLogin(): Promise<CodexLoginStart> {
  const id = randomUUID()
  const login: Login = Object.assign(openTerminal(['codex', 'login', '--device-auth'], { ...agentEnv('codex'), BROWSER: '/usr/bin/true' }), {
    timer: setTimeout(() => end(id), loginTimeout),
  })
  logins.set(id, login)
  const found = await waitFor(
    login,
    (output) => {
      const text = plain(output)
      const url = /https:\/\/\S+\/device\b/.exec(text)?.[0]
      const code = /\b[A-Z0-9]{4}-[A-Z0-9]{4,6}\b/.exec(text)?.[0]
      return url && code ? { url, code } : undefined
    },
    30_000,
  )
  if (!found) {
    const tail = plain(login.output).replace(/\s+/g, ' ').trim().slice(-200)
    end(id)
    throw new Error(`没拿到登录码${tail ? `：${tail}` : ''}`)
  }
  return { id, ...found }
}

// 这次登录现在怎么样了：waiting 还在等用户授权，done 登录好了，failed 没成功（error 是原因）
export function codexLoginStatus(id: string): CodexLoginStatus {
  const login = logins.get(id)
  if (!login) {
    return { status: 'failed', error: '这次登录已经结束了，重新开始' }
  }
  if (login.exitCode === undefined) {
    return { status: 'waiting' }
  }
  const tail = plain(login.output).replace(/\s+/g, ' ').trim().slice(-200)
  end(id)
  if (login.exitCode !== 0) {
    return { status: 'failed', error: `登录没成功，codex 最后说：「${tail || '（什么都没说）'}」` }
  }
  codexAuth()
  return { status: 'done' }
}

export function cancelCodexLogin(id: string) {
  end(id)
}
