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
