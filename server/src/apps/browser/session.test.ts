import { EventEmitter } from 'node:events'
import type { BrowserContext, Page } from 'playwright-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chromeContext, disconnectChrome } from './connection.js'
import type { BrowserServerMessage } from './protocol.js'
import { connectBrowser, stopBrowser } from './session.js'

vi.mock('./connection.js', () => ({
  chromeContext: vi.fn<typeof chromeContext>(),
  disconnectChrome: vi.fn<typeof disconnectChrome>(),
}))

function mockPage() {
  let url = 'about:blank'
  const cdp = Object.assign(new EventEmitter(), {
    send: vi.fn<(method: string) => Promise<unknown>>(async (method: string) => method === 'Page.getNavigationHistory' ? { currentIndex: 0, entries: [{ url, title: 'Test page' }] } : method === 'Page.captureScreenshot' ? { data: 'frame' } : {}),
  })
  const page = Object.assign(new EventEmitter(), {
    context: () => ({ newCDPSession: async () => cdp }),
    close: vi.fn<() => Promise<void>>(async () => { page.emit('close') }),
    goto: vi.fn<(next: string) => Promise<void>>(async (next: string) => { url = next }),
  })
  return { page, cdp }
}

let fixture: ReturnType<typeof mockPage>
let newPage: ReturnType<typeof vi.fn<BrowserContext['newPage']>>

beforeEach(() => {
  vi.useFakeTimers()
  fixture = mockPage()
  newPage = vi.fn<BrowserContext['newPage']>().mockResolvedValue(fixture.page as unknown as Page)
  vi.mocked(chromeContext).mockResolvedValue({ newPage } as unknown as BrowserContext)
})

afterEach(async () => {
  await stopBrowser()
  vi.useRealTimers()
  vi.clearAllMocks()
})

function client() {
  const messages: BrowserServerMessage[] = []
  return {
    messages,
    send: (message: BrowserServerMessage) => { messages.push(message) },
    close: vi.fn<(code?: number) => void>(),
    id: () => {
      const ready = messages.find((message) => message.type === 'ready')
      if (ready?.type !== 'ready') throw new Error('Browser not ready')
      return ready.id
    },
  }
}

describe('remote browser reconnection', () => {
  it('replaces an unclosed connection and preserves the existing page', async () => {
    const first = client()
    const old = await connectBrowser(undefined, first.send, first.close)
    const second = client()
    const fresh = await connectBrowser(first.id(), second.send, second.close)

    expect(second.id()).toBe(first.id())
    expect(newPage).toHaveBeenCalledOnce()
    expect(first.messages).toContainEqual({ type: 'replaced' })
    expect(first.close).toHaveBeenCalledExactlyOnceWith(4001)
    expect(fixture.page.close).not.toHaveBeenCalled()

    old.receive({ type: 'navigate', url: 'https://old.example/' })
    old.dispose()
    fresh.receive({ type: 'navigate', url: 'https://fresh.example/' })
    await vi.waitFor(() => expect(fixture.page.goto).toHaveBeenCalledExactlyOnceWith('https://fresh.example/', expect.any(Object)))
    expect(second.close).not.toHaveBeenCalled()
  })

  it('finishes old stream cleanup before starting the replacement stream', async () => {
    const first = client()
    await connectBrowser(undefined, first.send, first.close)
    let release: () => void = () => {}
    const cleanup = new Promise<void>((resolve) => { release = resolve })
    const originalSend = fixture.cdp.send.getMockImplementation()!
    fixture.cdp.send.mockImplementation(async (method) => {
      if (method === 'Page.stopScreencast') await cleanup
      return originalSend(method)
    })
    fixture.cdp.send.mockClear()
    const second = client()
    const connecting = connectBrowser(first.id(), second.send, second.close)
    await vi.waitFor(() => expect(fixture.cdp.send).toHaveBeenCalledWith('Page.stopScreencast'))
    expect(fixture.cdp.send.mock.calls.some(([method]) => method === 'Page.startScreencast')).toBe(false)
    release()
    await connecting
    expect(fixture.cdp.send.mock.calls.map(([method]) => method).filter((method) => method === 'Page.stopScreencast' || method === 'Page.startScreencast')).toEqual(['Page.stopScreencast', 'Page.startScreencast'])
  })

  it('allows only the newest of simultaneous replacements to remain active', async () => {
    const first = client()
    const old = await connectBrowser(undefined, first.send, first.close)
    const second = client()
    const third = client()
    const pendingSecond = connectBrowser(first.id(), second.send, second.close)
    const pendingThird = connectBrowser(first.id(), third.send, third.close)
    const [middle, fresh] = await Promise.all([pendingSecond, pendingThird])
    old.dispose()
    middle.dispose()
    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(20000)
      fresh.receive({ type: 'ping' })
    }
    await vi.advanceTimersByTimeAsync(1000)
    expect(second.close).toHaveBeenCalledExactlyOnceWith(4001)
    expect(third.messages.some((message) => message.type === 'state')).toBe(true)
    expect(fixture.page.close).not.toHaveBeenCalled()
    expect(third.close).not.toHaveBeenCalled()
  })

  it('allows reconnection when Chrome exits without treating it as an explicit close', async () => {
    const current = client()
    await connectBrowser(undefined, current.send, current.close)
    fixture.page.emit('close')
    expect(current.close).toHaveBeenCalledExactlyOnceWith(1000)
    expect(current.messages).not.toContainEqual({ type: 'closed' })
    expect(current.messages).not.toContainEqual({ type: 'replaced' })
  })

  it('closes only the owned page and invalidates the remote session', async () => {
    const current = client()
    const connection = await connectBrowser(undefined, current.send, current.close)
    connection.receive({ type: 'close' })
    expect(current.messages).toContainEqual({ type: 'closed' })
    expect(current.close).toHaveBeenCalledExactlyOnceWith(1000)
    expect(fixture.page.close).toHaveBeenCalledOnce()
    connection.receive({ type: 'navigate', url: 'https://example.com/' })
    expect(fixture.page.goto).not.toHaveBeenCalled()
  })

  it('captures the current viewport instead of transmitting compositor frame pixels', async () => {
    const current = client()
    const connection = await connectBrowser(undefined, current.send, current.close)
    const originalSend = fixture.cdp.send.getMockImplementation()!
    fixture.cdp.send.mockImplementation(async (method) => method === 'Page.captureScreenshot' ? { data: 'viewport-pixels' } : originalSend(method))
    connection.receive({ type: 'resize', width: 402, height: 524, scale: 2 })
    await vi.waitFor(() => expect(fixture.cdp.send).toHaveBeenCalledWith('Emulation.setDeviceMetricsOverride', expect.objectContaining({ width: 402, height: 524, deviceScaleFactor: 2 })))
    fixture.cdp.emit('Page.screencastFrame', { sessionId: 70, data: 'compositor-pixels', metadata: { deviceWidth: 1200, deviceHeight: 800 } })
    await vi.waitFor(() => expect(current.messages.filter((message) => message.type === 'frame')).toEqual([
      { type: 'frame', frame: 1, data: 'viewport-pixels', more: false, width: 402, height: 524 },
    ]))
    expect(fixture.cdp.send).toHaveBeenCalledWith('Page.captureScreenshot', { format: 'jpeg', quality: 85, fromSurface: true, captureBeyondViewport: false })
  })

  it('serializes viewport changes and input behind an in-flight capture', async () => {
    const current = client()
    const connection = await connectBrowser(undefined, current.send, current.close)
    let finish: (value: { data: string }) => void = () => {}
    const screenshot = new Promise<{ data: string }>((resolve) => { finish = resolve })
    const originalSend = fixture.cdp.send.getMockImplementation()!
    let captures = 0
    fixture.cdp.send.mockImplementation(async (method) => {
      if (method === 'Page.captureScreenshot') return ++captures === 1 ? screenshot : { data: 'new-size' }
      return originalSend(method)
    })
    fixture.cdp.emit('Page.screencastFrame', { sessionId: 70 })
    await vi.waitFor(() => expect(captures).toBe(1))
    connection.receive({ type: 'resize', width: 402, height: 524, scale: 2 })
    connection.receive({ type: 'pointer', action: 'down', x: 35, y: 35, button: 'left', buttons: 1, clickCount: 1 })
    await vi.advanceTimersByTimeAsync(0)
    expect(fixture.cdp.send).not.toHaveBeenCalledWith('Input.dispatchMouseEvent', expect.anything())
    expect(fixture.cdp.send).not.toHaveBeenCalledWith('Emulation.setDeviceMetricsOverride', expect.objectContaining({ width: 402 }))
    finish({ data: 'old-size' })
    await vi.waitFor(() => expect(fixture.cdp.send).toHaveBeenCalledWith('Input.dispatchMouseEvent', expect.objectContaining({ x: 35, y: 35 })))
    fixture.cdp.emit('Page.screencastFrame', { sessionId: 71 })
    await vi.waitFor(() => expect(current.messages.filter((message) => message.type === 'frame')).toEqual([
      { type: 'frame', frame: 1, data: 'old-size', more: false, width: 1200, height: 800 },
      { type: 'frame', frame: 2, data: 'new-size', more: false, width: 402, height: 524 },
    ]))
  })

  it('accepts leave-page confirmations and dismisses other dialogs', async () => {
    const current = client()
    await connectBrowser(undefined, current.send, current.close)
    const dialog = (type: string) => ({ type: () => type, message: () => 'Leave?', accept: vi.fn<() => Promise<void>>(async () => {}), dismiss: vi.fn<() => Promise<void>>(async () => {}) })
    const leave = dialog('beforeunload')
    const confirm = dialog('confirm')
    fixture.page.emit('dialog', leave)
    fixture.page.emit('dialog', confirm)
    expect(leave.accept).toHaveBeenCalledOnce()
    expect(leave.dismiss).not.toHaveBeenCalled()
    expect(confirm.dismiss).toHaveBeenCalledOnce()
    expect(confirm.accept).not.toHaveBeenCalled()
  })

  it('opens new-tab links in the current page but rejects popups that keep an opener', async () => {
    const current = client()
    await connectBrowser(undefined, current.send, current.close)
    const popup = (url: string, standalone: boolean) => ({ url: () => url, evaluate: async () => standalone, close: vi.fn<() => Promise<void>>(async () => {}) })
    const link = popup('https://link.example/', true)
    fixture.page.emit('popup', link)
    await vi.waitFor(() => expect(fixture.page.goto).toHaveBeenCalledExactlyOnceWith('https://link.example/', expect.any(Object)))
    expect(link.close).toHaveBeenCalledOnce()
    const login = popup('https://login.example/', false)
    fixture.page.emit('popup', login)
    await vi.waitFor(() => expect(login.close).toHaveBeenCalledOnce())
    expect(fixture.page.goto).toHaveBeenCalledOnce()
    expect(current.messages).toContainEqual({ type: 'error', message: '当前远程模式暂不支持新窗口，请使用网页内的链接导航' })
  })

  it('closes a failed metadata connection normally so the client can retry', async () => {
    const current = client()
    await connectBrowser(undefined, current.send, current.close)
    await vi.advanceTimersByTimeAsync(0)
    fixture.cdp.send.mockRejectedValueOnce(new Error('Connection failed'))
    await vi.advanceTimersByTimeAsync(1000)
    expect(current.close).toHaveBeenCalledExactlyOnceWith(1000)
    expect(current.messages).not.toContainEqual({ type: 'replaced' })
  })


  it('refreshes background pages without repaint events and skips unchanged pixels', async () => {
    const current = client()
    const connection = await connectBrowser(undefined, current.send, current.close)
    await vi.advanceTimersByTimeAsync(0)
    expect(current.messages.filter((message) => message.type === 'frame')).toHaveLength(1)
    connection.receive({ type: 'ack', frame: 1 })
    await vi.advanceTimersByTimeAsync(400)
    expect(current.messages.filter((message) => message.type === 'frame')).toHaveLength(1)
    const originalSend = fixture.cdp.send.getMockImplementation()!
    fixture.cdp.send.mockImplementation(async (method) => method === 'Page.captureScreenshot' ? { data: 'changed-background' } : originalSend(method))
    await vi.advanceTimersByTimeAsync(200)
    expect(current.messages.filter((message) => message.type === 'frame')).toContainEqual({
      type: 'frame', frame: 2, data: 'changed-background', more: false, width: 1200, height: 800,
    })
  })

})
