import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import os from 'node:os'
import { promisify } from 'node:util'
import { ApiException } from '../../errors.js'
import { appDir } from '../../paths.js'

const execute = promisify(execFile)
export const tmux = ['/opt/homebrew/bin/tmux', '/usr/local/bin/tmux', '/usr/bin/tmux'].find(existsSync)
// 正式版、开发和每个 PR 各自使用一个 tmux server，名称跨 binOS 更新保持不变。
export const socketName = `binos-${createHash('sha256').update(appDir('terminal')).digest('hex').slice(0, 16)}`
export const sessionPattern = /^terminal-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
export type TerminalSession = { id: string; created: number; cwd: string; command: string }

export function terminalEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: os.userInfo().homedir,
    TERM: 'xterm-256color',
    TERM_PROGRAM: 'binOS',
    LANG: process.env.LANG || 'en_US.UTF-8',
    COLORTERM: 'truecolor',
  }
  for (const key of Object.keys(env)) {
    if (
      key.startsWith('BINOS_') ||
      key.startsWith('CODEX_') ||
      ['CLAUDECODE', 'TMUX', 'TMUX_PANE', 'TERM_PROGRAM_VERSION', 'CLAUDE_CONFIG_DIR', 'NODE_OPTIONS', 'PORT'].includes(key)
    )
      delete env[key]
  }
  env.PATH = (env.PATH ?? '/usr/bin:/bin:/usr/sbin:/sbin')
    .split(':')
    .filter((dir) => !dir.includes('node_modules'))
    .join(':')
  return env
}

export async function runTmux(args: string[]) {
  if (!tmux) throw new ApiException(503, 'unavailable', '宿主 Mac 尚未安装 tmux，请在 Mac Terminal 中运行 brew install tmux')
  return (await execute(tmux, ['-L', socketName, '-f', '/dev/null', ...args], { env: terminalEnv(), timeout: 5000, maxBuffer: 1024 * 1024 })).stdout
}

export async function listSessions(): Promise<TerminalSession[]> {
  if (!tmux) return []
  let output: string
  try {
    output = await runTmux(['list-sessions', '-F', '#{session_name}\t#{session_created}\t#{pane_current_path}'])
  } catch (error) {
    if (/no server running|error connecting|No such file/.test(String((error as { stderr?: string }).stderr))) return []
    throw error
  }
  return output
    .trim()
    .split('\n')
    .flatMap((line) => {
      const [id, created, ...cwd] = line.split('\t')
      return sessionPattern.test(id)
        ? [{ id, created: Number(created) * 1000, cwd: cwd.join('\t'), command: `${tmux} -L ${socketName} attach-session -t ${id}` }]
        : []
    })
    .sort((a, b) => a.created - b.created || a.id.localeCompare(b.id))
}

let creating = false
export async function createSession() {
  if (creating) throw new ApiException(409, 'busy', '正在创建终端，请稍后重试')
  creating = true
  const id = `terminal-${randomUUID()}`
  try {
    if ((await listSessions()).length >= 16) throw new ApiException(409, 'capacity', '最多保留 16 个终端，请先结束不用的会话')
    // Detached tmux server 自成进程组，后端重启不会结束其中的 shell。
    const shell = os.userInfo().shell || '/bin/zsh'
    await runTmux([
      'new-session',
      '-d',
      '-s',
      id,
      '-c',
      os.userInfo().homedir,
      '-x',
      '80',
      '-y',
      '24',
      shell,
      '-il',
      ';',
      'set-option',
      '-t',
      id,
      'status',
      'off',
      ';',
      'set-option',
      '-t',
      id,
      'history-limit',
      '10000',
      ';',
      'set-option',
      '-t',
      id,
      'mouse',
      'on',
      ';',
      'set-option',
      '-t',
      id,
      'destroy-unattached',
      'off',
    ])
    return (await listSessions()).find((session) => session.id === id)!
  } finally {
    creating = false
  }
}

export async function hasSession(id: string) {
  return sessionPattern.test(id) && (await listSessions()).some((session) => session.id === id)
}
