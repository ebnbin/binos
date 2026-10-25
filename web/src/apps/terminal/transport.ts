import { errorMessage } from '../../api.ts'

type Message = { type: string; data?: string; message?: string }
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
  const url = new URL(`${base}/sessions/${id}/socket`, location.href)
  url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const socket = new WebSocket(url)
  const stop = () => {
    if (closed) return
    closed = true
    socket.close()
    disconnected()
  }
  socket.onmessage = (event) => receive(JSON.parse(event.data) as Message)
  socket.onclose = stop
  socket.onerror = stop
  return {
    close() {
      closed = true
      socket.close()
    },
    send(value) {
      if (closed || socket.readyState !== WebSocket.OPEN) return
      if (socket.bufferedAmount > 1024 * 1024) return stop()
      socket.send(JSON.stringify(value))
    },
  }
}
