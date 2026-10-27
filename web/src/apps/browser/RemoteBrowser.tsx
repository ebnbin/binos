import { ArrowClockwiseIcon, ArrowLeftIcon, ArrowRightIcon, KeyboardIcon, XIcon } from '@phosphor-icons/react'
import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react'
import type { BrowserState, BrowserClientMessage, BrowserServerMessage } from '@binos/server/apps/browser/protocol'
import { IconButton } from '../../ui/IconButton.tsx'
import type { WindowContext } from '../types.ts'
import { addressRoute, browserAddress, routeAddress } from './address.ts'
import styles from './BrowserApp.module.css'

export function RemoteBrowser({ ctx, session }: { ctx: WindowContext; session: RefObject<string | undefined> }) {
  const initialUrl = routeAddress(ctx.route)
  const [address, setAddress] = useState(initialUrl)
  const [state, setState] = useState<BrowserState>({ url: '', title: '', canBack: false, canForward: false })
  const [status, setStatus] = useState('正在连接远程浏览器…')
  const [error, setError] = useState('')
  const [closed, setClosed] = useState(false)
  const [retry, setRetry] = useState(0)
  const viewport = useRef<HTMLDivElement>(null)
  const image = useRef<HTMLImageElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const socket = useRef<WebSocket | null>(null)
  const touch = useRef<{ x: number; y: number; startX: number; startY: number; scrolling: boolean } | null>(null)
  const route = useRef(initialUrl)
  const ctxRef = useRef(ctx)
  useEffect(() => { ctxRef.current = ctx }, [ctx])
  const send = (message: BrowserClientMessage) => {
    if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify(message))
  }

  function point(event: { clientX: number; clientY: number }) {
    const rect = image.current!.getBoundingClientRect()
    const width = Number(image.current!.dataset.width || rect.width)
    const height = Number(image.current!.dataset.height || rect.height)
    const scale = Math.min(rect.width / (image.current!.naturalWidth || width), rect.height / (image.current!.naturalHeight || height))
    const paintedWidth = (image.current!.naturalWidth || width) * scale
    const paintedHeight = (image.current!.naturalHeight || height) * scale
    const left = rect.left + (rect.width - paintedWidth) / 2
    const top = rect.top + (rect.height - paintedHeight) / 2
    return { x: Math.max(0, Math.min(width, (event.clientX - left) * width / paintedWidth)), y: Math.max(0, Math.min(height, (event.clientY - top) * height / paintedHeight)) }
  }

  useEffect(() => {
    if (closed) return
    let stopped = false
    let reconnect: ReturnType<typeof setTimeout> | undefined
    let resizeTimer: ReturnType<typeof setTimeout> | undefined
    let connection: WebSocket | undefined
    let ready = false
    let parts = ''
    let frame = 0
    let requestedNavigation: string | undefined
    let attempts = 0
    let replaced = false
    let lastMessage = Date.now()
    const resize = () => {
      clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => {
        const rect = viewport.current?.getBoundingClientRect()
        if (rect && rect.width > 0 && rect.height > 0 && ready) send({ type: 'resize', width: Math.min(4096, Math.round(rect.width)), height: Math.min(4096, Math.round(rect.height)), scale: Math.min(2, window.devicePixelRatio || 1) })
      }, 150)
    }
    const observer = new ResizeObserver(resize)
    if (viewport.current) observer.observe(viewport.current)
    window.addEventListener('resize', resize)
    const connect = () => {
      if (stopped || replaced) return
      clearTimeout(reconnect)
      ready = false
      parts = ''
      lastMessage = Date.now()
      setError('')
      setStatus('正在连接远程浏览器…')
      const url = new URL('/api/apps/browser/socket', location.href)
      url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
      if (session.current) url.searchParams.set('session', session.current)
      const ws = new WebSocket(url)
      connection = ws
      socket.current = ws
      ws.onmessage = (event) => {
        if (stopped || connection !== ws) return
        lastMessage = Date.now()
        const message = JSON.parse(event.data) as BrowserServerMessage
        switch (message.type) {
          case 'ready': {
            session.current = message.id
            ready = true
            attempts = 0
            setError('')
            setStatus('正在加载页面…')
            resize()
            requestedNavigation = route.current
            break
          }
          case 'state':
            if (requestedNavigation !== undefined) {
              const requested = requestedNavigation
              requestedNavigation = undefined
              if (requested && requested !== message.state.url) {
                send({ type: 'navigate', url: requested })
                break
              }
            }
            setState(message.state)
            ctxRef.current.setTitle(message.state.title || (message.state.url ? new URL(message.state.url).host : ''))
            // 只在网址变化时同步地址栏，标题等其他状态变化不能覆盖正在输入的内容
            if (route.current !== message.state.url) {
              setAddress(message.state.url)
              route.current = message.state.url
              ctxRef.current.navigate(addressRoute(message.state.url), { replace: true })
            }
            break
          case 'frame': {
            if (frame !== message.frame) { parts = ''; frame = message.frame }
            parts += message.data
            if (parts.length > 16 * 1024 * 1024) { ws.close(); return }
            if (message.more) { send({ type: 'ack', frame: message.frame }); break }
            const target = image.current
            if (target) {
              target.onload = () => { if (connection === ws && !stopped && !replaced) { setStatus(''); send({ type: 'ack', frame: message.frame }) } }
              target.onerror = () => { if (connection === ws && !stopped && !replaced) send({ type: 'ack', frame: message.frame }) }
              target.dataset.width = String(message.width)
              target.dataset.height = String(message.height)
              target.src = `data:image/jpeg;base64,${parts}`
            }
            parts = ''
            break
          }
          case 'closed':
            stopped = true
            ready = false
            session.current = undefined
            image.current?.removeAttribute('src')
            setError('')
            setStatus('远程标签页已关闭')
            setClosed(true)
            break
          case 'replaced':
            replaced = true
            ready = false
            setStatus('连接已由新连接接替')
            break
          case 'ping': send({ type: 'ping' }); break
          case 'error': setError(message.message); break
        }
      }
      ws.onclose = (event) => {
        if (stopped || connection !== ws) return
        if (replaced || event.code === 4001) {
          replaced = true
          setStatus('连接已由新连接接替')
          return
        }
        ready = false
        setStatus('连接已断开')
        if (++attempts <= 3) reconnect = setTimeout(connect, 1500 * attempts)
      }
    }
    const resume = () => {
      if (stopped || replaced) return
      const previous = connection
      connection = undefined
      previous?.close()
      connect()
    }
    const visibility = () => { if (!document.hidden) resume() }
    window.addEventListener('online', resume)
    document.addEventListener('visibilitychange', visibility)
    const watchdog = setInterval(() => {
      if (ready && !document.hidden && Date.now() - lastMessage > 30000) resume()
    }, 5000)
    const surface = image.current
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      if (!surface?.src) return
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? surface.clientHeight : 1
      send({ type: 'wheel', ...point(event), deltaX: Math.max(-10000, Math.min(10000, event.deltaX * unit)), deltaY: Math.max(-10000, Math.min(10000, event.deltaY * unit)) })
    }
    const editor = input.current
    const beforeInput = (event: InputEvent) => {
      if (event.isComposing) return
      const key = event.inputType === 'deleteContentBackward' ? 'Backspace' : event.inputType === 'deleteContentForward' ? 'Delete' : ['insertLineBreak', 'insertParagraph'].includes(event.inputType) ? 'Enter' : undefined
      if (!key) return
      event.preventDefault()
      send({ type: 'key', action: 'down', key, code: key, modifiers: 0 })
      send({ type: 'key', action: 'up', key, code: key, modifiers: 0 })
    }
    editor?.addEventListener('beforeinput', beforeInput)
    surface?.addEventListener('wheel', wheel, { passive: false })
    connect()
    return () => {
      stopped = true
      clearInterval(watchdog)
      window.removeEventListener('online', resume)
      document.removeEventListener('visibilitychange', visibility)
      surface?.removeEventListener('wheel', wheel)
      editor?.removeEventListener('beforeinput', beforeInput)
      clearTimeout(reconnect)
      clearTimeout(resizeTimer)
      observer.disconnect()
      window.removeEventListener('resize', resize)
      connection?.close()
      if (socket.current === connection) socket.current = null
    }
  }, [closed, retry, session])

  useEffect(() => {
    if (initialUrl !== route.current) {
      route.current = initialUrl
      setAddress(initialUrl)
      if (initialUrl) send({ type: 'navigate', url: initialUrl })
    }
  }, [initialUrl])

  function visit() {
    try {
      const url = browserAddress(address)
      if (new URL(url).origin === location.origin) throw new Error('请通过 binOS 界面打开自身应用')
      setError('')
      send({ type: 'navigate', url })
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }

  function pointer(event: ReactPointerEvent, action: 'move' | 'down' | 'up') {
    if (!image.current?.src) return
    if (event.pointerType === 'touch') {
      event.preventDefault()
      if (action === 'down') {
        event.currentTarget.setPointerCapture(event.pointerId)
        touch.current = { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, scrolling: false }
      } else if (touch.current) {
        const previous = touch.current
        if (action === 'move') {
          if (Math.hypot(event.clientX - previous.startX, event.clientY - previous.startY) > 8) previous.scrolling = true
          if (previous.scrolling) send({ type: 'wheel', ...point(event), deltaX: previous.x - event.clientX, deltaY: previous.y - event.clientY })
          previous.x = event.clientX
          previous.y = event.clientY
        } else {
          if (!previous.scrolling && event.type !== 'pointercancel') {
            send({ type: 'pointer', action: 'down', ...point(event), button: 'left', buttons: 1, clickCount: 1 })
            send({ type: 'pointer', action: 'up', ...point(event), button: 'left', buttons: 0, clickCount: 1 })
          }
          touch.current = null
        }
      }
      return
    }
    if (action === 'down') {
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      input.current?.focus({ preventScroll: true })
    }
    send({ type: 'pointer', action, ...point(event), button: event.button === 2 ? 'right' : event.button === 1 ? 'middle' : 'left', buttons: event.buttons, clickCount: action === 'move' ? 0 : Math.min(3, Math.max(1, event.detail)) })
  }

  return <div className={styles.remote}>
    <div className={styles.toolbar}>
      <div className={styles.navigation}>
        <IconButton icon={ArrowLeftIcon} label="后退" disabled={closed || !state.canBack} onClick={() => send({ type: 'back' })} />
        <IconButton icon={ArrowRightIcon} label="前进" disabled={closed || !state.canForward} onClick={() => send({ type: 'forward' })} />
      </div>
      <div className={styles.navigation}>
        <IconButton icon={ArrowClockwiseIcon} label="刷新网页" disabled={closed} onClick={() => send({ type: 'reload' })} />
        <IconButton icon={KeyboardIcon} label="输入文字" disabled={closed} onClick={() => input.current?.focus({ preventScroll: true })} />
        <IconButton icon={XIcon} label="关闭远程标签页" disabled={closed || !session.current} onClick={() => send({ type: 'close' })} />
      </div>
      <form className={styles.address} onSubmit={(event) => { event.preventDefault(); visit() }}>
        <input aria-label="网址" value={address} onChange={(event) => setAddress(event.target.value)} onFocus={(event) => event.target.select()} placeholder="输入网址" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
        <button type="submit" className={styles.go} disabled={closed || !!status && status !== '正在加载页面…'}>前往</button>
      </form>
      <button type="button" className={styles.action} onClick={() => { setClosed(false); setRetry((value) => value + 1) }}>{closed ? '打开远程标签页' : '重新连接'}</button>
    </div>
    <div className={styles.notice}>使用 Mac 上个人 Chrome 的登录状态。当前支持页面画面与基础操作，暂不支持声音、文件传输、复制和新窗口。</div>
    {error && <p className={styles.error} role="alert">{error}</p>}
    <div ref={viewport} className={styles.remoteViewport}>
      <img ref={image} className={styles.remoteImage} style={closed ? { visibility: 'hidden' } : undefined} alt="远程浏览器页面" draggable={false}
        onPointerDown={(event) => pointer(event, 'down')}
        onPointerMove={(event) => pointer(event, 'move')}
        onPointerUp={(event) => pointer(event, 'up')}
        onPointerCancel={(event) => pointer(event, 'up')}
        onContextMenu={(event) => event.preventDefault()} />
      {status && <div className={styles.remoteStatus} role="status">{status}</div>}
      <textarea ref={input} className={styles.remoteInput} aria-label="远程网页输入" autoCapitalize="none" autoCorrect="off" spellCheck={false}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.key === 'Process' || event.key === 'Unidentified' || event.key === 'Dead') return
          const modifiers = (event.altKey ? 1 : 0) | (event.ctrlKey ? 2 : 0) | (event.metaKey ? 4 : 0) | (event.shiftKey ? 8 : 0)
          if ((event.metaKey || event.ctrlKey) && ['v', 'c', 'x'].includes(event.key.toLowerCase())) return
          if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) return
          event.preventDefault()
          send({ type: 'key', action: 'down', key: event.key, code: event.code, modifiers })
        }}
        onKeyUp={(event) => {
          if (event.nativeEvent.isComposing) return
          send({ type: 'key', action: 'up', key: event.key, code: event.code, modifiers: (event.altKey ? 1 : 0) | (event.ctrlKey ? 2 : 0) | (event.metaKey ? 4 : 0) | (event.shiftKey ? 8 : 0) })
        }}
        onInput={(event) => {
          if ((event.nativeEvent as InputEvent).isComposing) return
          const target = event.currentTarget
          if (target.value) send({ type: 'text', text: target.value })
          target.value = ''
        }}
        onCompositionEnd={(event) => { if (event.data) send({ type: 'text', text: event.data }); event.currentTarget.value = '' }}
        onPaste={(event) => { event.preventDefault(); const text = event.clipboardData.getData('text/plain'); if (text) send({ type: 'text', text: text.slice(0, 16384) }) }} />
    </div>
  </div>
}
