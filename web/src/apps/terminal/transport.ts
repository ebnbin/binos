import { errorMessage } from '../../api.ts'

type Message = { type: string; data?: string; message?: string; id?: string }
export type TerminalTransport = { send(value: object): void; close(): void }
const base = '/api/apps/terminal'

export async function terminalRequest<T>(path: string, method = 'GET'): Promise<T> {
  const response = await fetch(`${base}${path === '/' ? '' : path}`, {
    method,
    ...(method === 'POST' && { headers: { 'Content-Type': 'application/json' }, body: '{}' }),
  })
  if (!response.ok) throw new Error(await errorMessage(response, '请求失败'))
  return (response.status === 204 ? undefined : await response.json()) as T
}

export function openTerminal(id: string, receive: (message: Message) => void, disconnected: () => void): TerminalTransport {
  let closed = false
  let socket: WebSocket | undefined
  let source: EventSource | undefined
  let connection: string | undefined
  let queue = Promise.resolve()
  let queued = 0
  let established = false
  let fallbackTimer: ReturnType<typeof setTimeout> | undefined
  const stop = () => {
    if (closed) return
    closed = true
    clearTimeout(fallbackTimer)
    socket?.close()
    source?.close()
    disconnected()
  }
  const fallback = () => {
    if (closed || source) return
    clearTimeout(fallbackTimer)
    socket?.close()
    socket = undefined
    source = new EventSource(`${base}/sessions/${id}/stream`)
    source.onmessage = (event) => {
      const message = JSON.parse(event.data) as Message
      if (message.type === 'connection') connection = message.id
      else receive(message)
    }
    source.onerror = stop
  }
  // 已上线的旧版本只支持 HTTP 预览转发。
  if (/^pr-\d+\.binos\.app$/.test(location.hostname)) fallback()
  else {
    const url = new URL(`${base}/sessions/${id}/socket`, location.href)
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    socket = new WebSocket(url)
    socket.onopen = () => {
      established = true
      clearTimeout(fallbackTimer)
    }
    socket.onmessage = (event) => receive(JSON.parse(event.data) as Message)
    socket.onclose = () => {
      if (source || closed) return
      if (established) stop()
      else fallback()
    }
    socket.onerror = () => {
      if (!established) fallback()
      else stop()
    }
    fallbackTimer = setTimeout(fallback, 4000)
  }
  return {
    close() {
      closed = true
      clearTimeout(fallbackTimer)
      socket?.close()
      source?.close()
    },
    send(value) {
      if (closed) return
      const body = JSON.stringify(value)
      if (socket?.readyState === WebSocket.OPEN) {
        if (socket.bufferedAmount > 1024 * 1024) return stop()
        socket.send(body)
      } else if (source && connection) {
        if (queued + body.length > 1024 * 1024) return stop()
        queued += body.length
        queue = queue
          .then(async () => {
            if (closed) return
            const response = await fetch(`${base}/connections/${connection}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
            if (!response.ok) stop()
          })
          .catch(stop)
          .finally(() => {
            queued -= body.length
          })
      }
    },
  }
}
