const retryDelay = 1000
// 后端每 15 秒发一次 ping，这么久什么都没收到，说明连接已经断了却没有报错（比如手机切换网络、电脑睡眠后）
const silenceLimit = 45_000
// 回到前台时，超过一次 ping 的间隔没有收到数据，就不等 silenceLimit，立刻重连
const visibleSilenceLimit = 20_000
// 连接中超过这么久还没连上就算失败。网络出错时浏览器会一直自己重连，不会报失败
const connectLimit = 15_000

// 连接的进展：正在连（包括第一次连和断开后重连）、已连上、失败（被拒绝或者迟迟连不上）。失败后仍然在后台重连，连上之前一直算失败
export type ConnectionProgress = 'connecting' | 'open' | 'failed'

// 网络断开时浏览器自己重连；连接被拒绝（比如登录过期、后端重启时拿到 Cloudflare 的错误页）时浏览器不再重连，隔一会儿由这里重连。
// 连接或重连迟迟没有结果时也由这里重连。返回关闭连接的函数
export function connectEventSource(
  url: () => string,
  handlers: {
    onMessage: (data: string) => void
    onOpen?: () => void
    onConnectedChange?: (connected: boolean) => void
    onProgress?: (progress: ConnectionProgress) => void
  },
): () => void {
  let source: EventSource | undefined
  let retry: number | undefined
  let watchdog: number | undefined
  let lastActivity = Date.now()
  let progress: ConnectionProgress | undefined
  let giveUp: number | undefined
  const report = (next: ConnectionProgress) => {
    if (next !== 'connecting') {
      window.clearTimeout(giveUp)
      giveUp = undefined
    } else if (giveUp === undefined) {
      giveUp = window.setTimeout(() => report('failed'), connectLimit)
    }
    if (next !== progress) {
      progress = next
      handlers.onProgress?.(next)
    }
  }
  const alive = () => {
    lastActivity = Date.now()
    window.clearTimeout(watchdog)
    watchdog = window.setTimeout(() => {
      handlers.onConnectedChange?.(false)
      connect()
    }, silenceLimit)
  }

  const connect = () => {
    window.clearTimeout(retry)
    source?.close()
    const current = new EventSource(url())
    source = current
    alive()
    if (progress !== 'failed') {
      report('connecting')
    }
    current.onopen = () => {
      alive()
      report('open')
      handlers.onConnectedChange?.(true)
      handlers.onOpen?.()
    }
    current.onmessage = (message) => {
      alive()
      handlers.onMessage(message.data)
    }
    current.addEventListener('ping', alive)
    current.onerror = () => {
      handlers.onConnectedChange?.(false)
      if (current.readyState === EventSource.CLOSED) {
        window.clearTimeout(watchdog)
        report('failed')
        retry = window.setTimeout(connect, retryDelay)
      } else if (progress !== 'failed') {
        report('connecting')
      }
    }
  }
  const onVisible = () => {
    if (
      document.visibilityState === 'visible' &&
      (source?.readyState === EventSource.CLOSED || Date.now() - lastActivity > visibleSilenceLimit)
    ) {
      connect()
    }
  }

  document.addEventListener('visibilitychange', onVisible)
  connect()
  return () => {
    document.removeEventListener('visibilitychange', onVisible)
    window.clearTimeout(retry)
    window.clearTimeout(watchdog)
    window.clearTimeout(giveUp)
    source?.close()
  }
}
