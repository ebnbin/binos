import { randomUUID } from 'node:crypto'
import type { CDPSession, Page } from 'playwright-core'
import { chromeContext, disconnectChrome } from './connection.js'
import type { BrowserClientMessage, BrowserServerMessage } from './protocol.js'

const sessions = new Map<string, Session>()
let opening = 0

class Session {
  readonly id = randomUUID()
  send: ((message: BrowserServerMessage) => void) | undefined
  disconnect: ((replaced?: boolean) => void) | undefined
  expiry: ReturnType<typeof setTimeout> | undefined
  cdp!: CDPSession
  pendingFrame: number | undefined
  deferredSource: number | undefined
  capturing = false
  streaming = false
  revision = 0
  lastCapture = 0
  lastFrame: string | undefined
  refreshTimer: ReturnType<typeof setInterval> | undefined
  captureTimer: ReturnType<typeof setTimeout> | undefined
  frameWidth = 1200
  frameHeight = 800
  frame = 0
  chunksInFlight = 0
  remainingFrame = ''
  width = 1200
  height = 800
  scale = 1
  state = ''
  queue = Promise.resolve()

  readonly page: Page

  constructor(page: Page) { this.page = page }

  async start() {
    this.cdp = await this.page.context().newCDPSession(this.page)
    this.page.on('dialog', (dialog) => {
      // 离开页面的确认来自用户自己的导航，取消会让后退、跳转都停在原页
      if (dialog.type() === 'beforeunload') {
        void dialog.accept().catch(() => {})
        return
      }
      this.emit({ type: 'error', message: `网页弹窗已关闭：${dialog.message().slice(0, 300)}` })
      void dialog.dismiss().catch(() => {})
    })
    this.page.on('popup', (popup) => void this.popup(popup))
    this.page.on('download', (download) => {
      this.emit({ type: 'error', message: '当前远程模式暂不支持文件下载' })
      void download.cancel().catch(() => {})
    })
    this.page.on('filechooser', () => this.emit({ type: 'error', message: '当前远程模式暂不支持文件上传' }))
    this.page.on('close', () => { this.disconnect?.(); this.destroy() })
    this.cdp.on('Page.screencastFrame', (frame) => {
      if (!this.send || !this.streaming) {
        void this.releaseSource(frame.sessionId)
        return
      }
      if (this.deferredSource !== undefined) void this.releaseSource(this.deferredSource)
      this.deferredSource = frame.sessionId
      this.captureNext()
    })
    await this.cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true })
    await this.viewport()
  }

  // 没有 opener 的新窗口（target="_blank" 链接等）不需要和原页面通信，改在当前页打开；登录等依赖 opener 的弹窗仍不支持
  async popup(popup: Page) {
    const url = popup.url()
    const standalone = await popup.evaluate('window.opener === null').catch(() => false)
    await popup.close().catch(() => {})
    if (!standalone || !/^https?:/.test(url)) {
      this.emit({ type: 'error', message: '当前远程模式暂不支持新窗口，请使用网页内的链接导航' })
      return
    }
    this.queue = this.queue.then(() => this.command({ type: 'navigate', url })).catch((error: unknown) => {
      this.emit({ type: 'error', message: error instanceof Error ? error.message : String(error) })
    })
  }

  async viewport() {
    await this.cdp.send('Emulation.setDeviceMetricsOverride', {
      width: this.width, height: this.height, deviceScaleFactor: this.scale, mobile: false,
      screenWidth: this.width, screenHeight: this.height,
    })
  }

  captureNext(force = false) {
    if (!this.send || !this.streaming) return
    if (force && this.deferredSource === undefined) this.deferredSource = -1
    if (this.capturing || this.pendingFrame !== undefined || this.deferredSource === undefined || this.captureTimer) return
    this.captureTimer = setTimeout(() => {
      this.captureTimer = undefined
      this.capturing = true
      this.queue = this.queue.then(() => this.capture())
    }, Math.max(0, 50 - (Date.now() - this.lastCapture)))
    this.captureTimer.unref()
  }

  async capture() {
    const sessionId = this.deferredSource
    this.deferredSource = undefined
    if (sessionId === undefined) { this.capturing = false; return }
    const { width, height, revision } = this
    this.capturing = true
    this.lastCapture = Date.now()
    try {
      const { data } = await this.cdp.send('Page.captureScreenshot', {
        format: 'jpeg', quality: 85, fromSurface: true, captureBeyondViewport: false,
      })
      if (revision !== this.revision || !this.streaming || !this.send) { await this.releaseSource(sessionId); return }
      if (data === this.lastFrame) { await this.releaseSource(sessionId); return }
      this.lastFrame = data
      this.pendingFrame = sessionId
      this.frame++
      this.frameWidth = width
      this.frameHeight = height
      this.remainingFrame = data
      this.fillChunks()
    } catch {
      await this.releaseSource(sessionId)
      this.disconnect?.()
    } finally {
      this.capturing = false
      this.captureNext()
    }
  }

  async releaseSource(sessionId: number) {
    if (sessionId < 0) return
    await this.cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {})
  }

  emit(message: BrowserServerMessage) {
    try { this.send?.(message) } catch { this.disconnect?.() }
  }

  async metadata() {
    const history = await this.cdp.send('Page.getNavigationHistory').catch((error: unknown) => {
      if (error instanceof Error && error.message.includes('Not attached to an active page')) return undefined
      throw error
    })
    if (!history) return
    const entry = history.entries[history.currentIndex]
    const state = {
      url: entry?.url === 'about:blank' ? '' : entry?.url ?? '', title: entry?.title ?? '',
      canBack: history.currentIndex > 0, canForward: history.currentIndex < history.entries.length - 1,
    }
    const serialized = JSON.stringify(state)
    if (this.state !== serialized && this.send) {
      this.state = serialized
      this.emit({ type: 'state', state })
    }
  }

  async stream() {
    // 有界面 Chrome 的 screencast 位图不保证匹配模拟视口，因此只用它监听重绘。
    this.streaming = true
    this.lastFrame = undefined
    await this.cdp.send('Page.startScreencast', { format: 'jpeg', quality: 85, maxWidth: 64, maxHeight: 64 })
    this.refreshTimer = setInterval(() => this.captureNext(true), 200)
    this.refreshTimer.unref()
    this.captureNext(true)
  }

  async command(message: BrowserClientMessage) {
    switch (message.type) {
      case 'navigate':
        await this.page.goto(message.url, { waitUntil: 'commit', timeout: 20000 })
        break
      case 'back': await this.page.goBack({ waitUntil: 'commit', timeout: 20000 }); break
      case 'forward': await this.page.goForward({ waitUntil: 'commit', timeout: 20000 }); break
      case 'reload': await this.page.reload({ waitUntil: 'commit', timeout: 20000 }); break
      case 'resize': {
        if (message.width === this.width && message.height === this.height && message.scale === this.scale) break
        await this.stopStream()
        this.width = message.width
        this.height = message.height
        this.scale = Math.min(message.scale, 2560 / Math.max(this.width, this.height))
        await this.viewport()
        await this.stream()
        break
      }
      case 'pointer':
        await this.cdp.send('Input.dispatchMouseEvent', {
          type: { move: 'mouseMoved', down: 'mousePressed', up: 'mouseReleased' }[message.action] as 'mouseMoved' | 'mousePressed' | 'mouseReleased',
          x: message.x, y: message.y, button: message.button, buttons: message.buttons, clickCount: message.clickCount,
        })
        break
      case 'wheel':
        await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: message.x, y: message.y, deltaX: message.deltaX, deltaY: message.deltaY })
        break
      case 'text': await this.cdp.send('Input.insertText', { text: message.text }); break
      case 'key': {
        const codes: Record<string, number> = { Backspace: 8, Tab: 9, Enter: 13, Escape: 27, ' ': 32, PageUp: 33, PageDown: 34, End: 35, Home: 36, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Delete: 46 }
        const keyCode = codes[message.key] ?? (message.key.length === 1 ? message.key.toUpperCase().charCodeAt(0) : 0)
        await this.cdp.send('Input.dispatchKeyEvent', {
          type: message.action === 'up' ? 'keyUp' : message.key === 'Enter' ? 'keyDown' : 'rawKeyDown',
          text: message.action === 'down' && message.key === 'Enter' ? '\r' : undefined, key: message.key, code: message.code,
          modifiers: message.modifiers, windowsVirtualKeyCode: keyCode,
          commands: message.action === 'down' && (message.modifiers & 6) && message.key.toLowerCase() === 'a' ? ['selectAll'] : undefined,
        })
        break
      }
    }
    await this.metadata()
  }

  fillChunks() {
    while (this.remainingFrame && this.chunksInFlight < 4) {
      const data = this.remainingFrame.slice(0, 48000)
      this.remainingFrame = this.remainingFrame.slice(48000)
      this.chunksInFlight++
      this.emit({ type: 'frame', frame: this.frame, data, more: !!this.remainingFrame, width: this.frameWidth, height: this.frameHeight })
    }
  }

  async ack(includeDeferred = true) {
    const sessionId = this.pendingFrame
    if (includeDeferred) {
      const deferred = this.deferredSource
      this.deferredSource = undefined
      if (deferred !== undefined) void this.releaseSource(deferred)
    }
    this.pendingFrame = undefined
    this.remainingFrame = ''
    this.chunksInFlight = 0
    if (sessionId !== undefined) await this.releaseSource(sessionId)
  }

  async stopStream() {
    this.streaming = false
    this.revision++
    clearTimeout(this.captureTimer)
    clearInterval(this.refreshTimer)
    this.captureTimer = undefined
    await this.cdp.send('Page.stopScreencast').catch(() => {})
    await this.ack()
  }

  destroy() {
    if (!sessions.delete(this.id)) return
    clearTimeout(this.expiry)
    clearTimeout(this.captureTimer)
    clearInterval(this.refreshTimer)
    this.streaming = false
    this.revision++
    this.send = undefined
    this.disconnect = undefined
    void this.page.close().catch(() => {})
  }
}

export async function connectBrowser(id: string | undefined, send: (message: BrowserServerMessage) => void, close: (code?: number) => void) {
  let session = id ? sessions.get(id) : undefined
  session?.disconnect?.(true)
  if (!session) {
    if (sessions.size + opening >= 4) throw new Error('最多同时打开 4 个远程浏览器页面，请关闭不用的窗口后稍候重试')
    opening++
    let page: Page | undefined
    try {
      page = await (await chromeContext()).newPage()
      session = new Session(page)
      await session.start()
      sessions.set(session.id, session)
    } catch (error) {
      await page?.close().catch(() => {})
      throw error
    } finally { opening-- }
  }
  const current = session
  clearTimeout(current.expiry)
  current.send = send
  current.state = ''
  let disposed = false
  let lastSeen = Date.now()
  let queued = 0
  let polling = false
  const dispose = (replaced = false) => {
    if (disposed) return
    disposed = true
    clearInterval(timer)
    if (replaced) {
      try { send({ type: 'replaced' }) } catch { /* 旧连接可能已断网 */ }
    }
    current.send = undefined
    current.disconnect = undefined
    current.queue = current.queue.then(async () => {
      await current.stopStream()
    })
    current.expiry = setTimeout(() => current.destroy(), 60000)
    current.expiry.unref()
    close(replaced ? 4001 : 1000)
  }
  current.disconnect = dispose
  const timer = setInterval(() => {
    if (Date.now() - lastSeen > 45000) return dispose()
    current.emit({ type: 'ping' })
    if (!polling) {
      polling = true
      void current.metadata().catch(() => dispose()).finally(() => { polling = false })
    }
  }, 1000)
  timer.unref()
  try {
    send({ type: 'ready', id: current.id })
    const start = current.queue.then(async () => {
      if (disposed) return
      await current.stream()
      await current.metadata()
    })
    current.queue = start.catch(() => {})
    await start
  } catch (error) { dispose(); throw error }
  return {
    dispose,
    receive(message: BrowserClientMessage) {
      if (disposed) return
      lastSeen = Date.now()
      if (message.type === 'close') {
        current.emit({ type: 'closed' })
        dispose()
        current.destroy()
        return
      }
      if (message.type === 'ping') return
      if (message.type === 'ack') {
        if (message.frame !== current.frame || current.pendingFrame === undefined) return
        if (current.chunksInFlight <= 0) return
        current.chunksInFlight--
        current.fillChunks()
        if (!current.chunksInFlight) void current.ack(false).then(() => current.captureNext())
        return
      }
      if (queued >= 128) return dispose()
      queued++
      current.queue = current.queue.then(async () => {
        if (!disposed) await current.command(message)
      }).catch((error: unknown) => {
        current.emit({ type: 'error', message: error instanceof Error ? error.message : String(error) })
      }).finally(() => { queued-- })
    },
  }
}

export async function stopBrowser() {
  const owned = [...sessions.values()]
  for (const session of owned) { session.disconnect?.(); session.destroy() }
  await Promise.allSettled(owned.map((session) => session.page.close()))
  await disconnectChrome()
}
