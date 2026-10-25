export type BrowserClientMessage =
  | { type: 'navigate'; url: string }
  | { type: 'resize'; width: number; height: number; scale: number }
  | { type: 'pointer'; action: 'move' | 'down' | 'up'; x: number; y: number; button: 'left' | 'right' | 'middle'; buttons: number; clickCount: number }
  | { type: 'wheel'; x: number; y: number; deltaX: number; deltaY: number }
  | { type: 'key'; action: 'down' | 'up'; key: string; code: string; modifiers: number }
  | { type: 'text'; text: string }
  | { type: 'ack'; frame: number }
  | { type: 'back' | 'forward' | 'reload' | 'ping' | 'close' }

export type BrowserState = { url: string; title: string; canBack: boolean; canForward: boolean }
export type BrowserServerMessage =
  | { type: 'ready'; id: string }
  | { type: 'state'; state: BrowserState }
  | { type: 'frame'; frame: number; data: string; more: boolean; width: number; height: number }
  | { type: 'error'; message: string }
  | { type: 'ping' | 'replaced' | 'closed' }

export function navigationUrl(value: string) {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('仅支持不含用户名和密码的 HTTP 或 HTTPS 网址')
  return url.href
}

export function parseMessage(value: unknown): BrowserClientMessage | undefined {
  if (!value || typeof value !== 'object') return
  const v = value as Record<string, unknown>
  const number = (key: string, min: number, max: number) => typeof v[key] === 'number' && Number.isFinite(v[key]) && Number(v[key]) >= min && Number(v[key]) <= max
  switch (v.type) {
    case 'navigate':
      if (typeof v.url !== 'string' || v.url.length > 8192) return
      try { return { type: 'navigate', url: navigationUrl(v.url) } } catch { return }
    case 'resize':
      if (number('width', 1, 4096) && number('height', 1, 4096) && number('scale', 1, 2)) return { type: 'resize', width: Math.round(Number(v.width)), height: Math.round(Number(v.height)), scale: Number(v.scale) }
      return
    case 'pointer':
      if (['move', 'down', 'up'].includes(String(v.action)) && ['left', 'right', 'middle'].includes(String(v.button)) && number('x', 0, 4096) && number('y', 0, 4096) && number('buttons', 0, 7) && number('clickCount', 0, 3)) return v as BrowserClientMessage
      return
    case 'wheel':
      if (number('x', 0, 4096) && number('y', 0, 4096) && number('deltaX', -10000, 10000) && number('deltaY', -10000, 10000)) return v as BrowserClientMessage
      return
    case 'key':
      if (['down', 'up'].includes(String(v.action)) && typeof v.key === 'string' && v.key.length <= 64 && typeof v.code === 'string' && v.code.length <= 64 && number('modifiers', 0, 15)) return v as BrowserClientMessage
      return
    case 'text':
      if (typeof v.text === 'string' && v.text.length <= 16384) return { type: 'text', text: v.text }
      return
    case 'ack':
      if (number('frame', 1, Number.MAX_SAFE_INTEGER) && Number.isInteger(v.frame)) return { type: 'ack', frame: Number(v.frame) }
      return
    case 'back': case 'forward': case 'reload': case 'ping': case 'close':
      return { type: v.type }
  }
}
