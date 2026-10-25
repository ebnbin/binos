import { spawn } from 'node-pty'
import { socketName, terminalEnv, tmux } from './sessions.js'

export type TerminalServerMessage = { type: 'output'; data: string } | { type: 'ready' | 'ping' | 'exit' } | { type: 'error'; message: string }
// 旧版正式后端转发不了 WebSocket 时的 SSE 通道：第一条是 connection，之后的输入带着它的 id 发到 POST /connections/:id
export type TerminalStreamMessage = { type: 'connection'; id: string } | TerminalServerMessage
export type TerminalClientMessage = { type: 'input'; data: string } | { type: 'resize'; cols: number; rows: number } | { type: 'ack'; size: number } | { type: 'ping' }

export function parseMessage(value: unknown): TerminalClientMessage | undefined {
  if (!value || typeof value !== 'object') return
  const v = value as Record<string, unknown>
  if (v.type === 'input' && typeof v.data === 'string' && v.data.length <= 16384) return { type: 'input', data: v.data }
  if (
    v.type === 'resize' &&
    Number.isInteger(v.cols) &&
    Number.isInteger(v.rows) &&
    Number(v.cols) >= 2 &&
    Number(v.cols) <= 500 &&
    Number(v.rows) >= 1 &&
    Number(v.rows) <= 200
  )
    return { type: 'resize', cols: Number(v.cols), rows: Number(v.rows) }
  if (v.type === 'ack' && Number.isInteger(v.size) && Number(v.size) > 0 && Number(v.size) <= 1024 * 1024) return { type: 'ack', size: Number(v.size) }
  if (v.type === 'ping') return { type: 'ping' }
}

export function connectTerminal(id: string, send: (message: TerminalServerMessage) => void, close: () => void) {
  const pty = spawn(tmux!, ['-L', socketName, 'attach-session', '-t', id], {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    env: terminalEnv(),
  })
  let pending = 0
  let stopped = false
  let lastSeen = Date.now()
  const dispose = () => {
    if (stopped) return
    stopped = true
    clearInterval(timer)
    data.dispose()
    exit.dispose()
    try {
      pty.kill()
    } catch {
      /* PTY 已退出 */
    }
    close()
  }
  const data = pty.onData((chunk) => {
    pending += chunk.length
    if (pending >= 256 * 1024) pty.pause()
    try {
      send({ type: 'output', data: chunk })
    } catch {
      dispose()
    }
  })
  const exit = pty.onExit(() => {
    try {
      send({ type: 'exit' })
    } finally {
      dispose()
    }
  })
  const timer = setInterval(() => {
    if (Date.now() - lastSeen > 60_000) return dispose()
    try {
      send({ type: 'ping' })
    } catch {
      dispose()
    }
  }, 15_000)
  try {
    send({ type: 'ready' })
  } catch (error) {
    dispose()
    throw error
  }
  return {
    dispose,
    receive(message: TerminalClientMessage) {
      if (stopped) return
      lastSeen = Date.now()
      switch (message.type) {
        case 'input':
          pty.write(message.data)
          break
        case 'resize':
          pty.resize(message.cols, message.rows)
          break
        case 'ack':
          if (message.size > pending) return dispose()
          pending -= message.size
          if (pending < 64 * 1024) pty.resume()
          break
      }
    },
  }
}
