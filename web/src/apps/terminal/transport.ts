import { ensureOk, readJson, request, socketUrl } from '../../api.ts'

type Message = { type: string; data?: string; message?: string }
export type TerminalTransport = { send(value: object): void; close(): void }

export const readTerminals = async () => readJson(await request('GET /api/apps/terminal'), '请求失败')
export const createTerminal = async () => readJson(await request('POST /api/apps/terminal/sessions'), '请求失败')
export const closeTerminal = async (id: string) => { await ensureOk(await request('DELETE /api/apps/terminal/sessions/:id', { params: { id } }), '请求失败') }

export function openTerminal(id: string, receive: (message: Message) => void, disconnected: () => void): TerminalTransport {
  let closed = false
  const socket = new WebSocket(socketUrl('GET /api/apps/terminal/sessions/:id/socket', { params: { id } }))
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
