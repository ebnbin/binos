import { ArrowLeft, ArrowRight, ArrowUpRight, Globe, House, RotateCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { IconButton } from '../../ui/IconButton.tsx'
import type { WindowContext } from '../types.ts'
import { addressRoute, browserAddress, isLoopback, routeAddress } from './address.ts'
import { RemoteBrowser } from './RemoteBrowser.tsx'
import styles from './BrowserApp.module.css'

// 顶层导航会替换整个 binOS，不能随嵌入网页一起放开。
const sandbox = 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals'

function IframeBrowser({ ctx }: { ctx: WindowContext }) {
  const requested = routeAddress(ctx.route)
  const url = requested && new URL(requested).origin !== window.location.origin ? requested : ''
  // HTTPS 页面里的 HTTP iframe 会被浏览器当作混合内容拦截，只有本机地址例外
  const insecure = !!url && window.location.protocol === 'https:' && new URL(url).protocol === 'http:' && !isLoopback(new URL(url))
  const [address, setAddress] = useState(url)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [history, setHistory] = useState({ entries: [url], index: 0 })
  const { setTitle } = ctx

  const [previousUrl, setPreviousUrl] = useState(url)
  if (previousUrl !== url) {
    setPreviousUrl(url)
    setAddress(url)
    setError('')
    setHistory((previous) => previous.entries[previous.index] === url ? previous : {
      entries: [...previous.entries.slice(0, previous.index + 1), url],
      index: previous.index + 1,
    })
  }

  useEffect(() => setTitle(url ? new URL(url).host : ''), [url, setTitle])

  function visit(next: string) {
    if (next === url) setRevision((value) => value + 1)
    ctx.navigate(addressRoute(next), { replace: true })
    setAddress(next)
    setError('')
  }

  function move(offset: number) {
    const index = history.index + offset
    setHistory({ ...history, index })
    visit(history.entries[index]!)
  }

  return (
    <div className={styles.app}>
      <div className={styles.toolbar}>
        <div className={styles.navigation}>
          <IconButton icon={ArrowLeft} label="上一个输入的网址" disabled={history.index === 0} onClick={() => move(-1)} />
          <IconButton icon={ArrowRight} label="下一个输入的网址" disabled={history.index === history.entries.length - 1} onClick={() => move(1)} />
        </div>
        <div className={styles.navigation}>
          <IconButton icon={RotateCw} label="重新打开输入的网址" disabled={!url} onClick={() => setRevision((value) => value + 1)} />
          <IconButton icon={House} label="浏览器首页" onClick={() => visit('')} />
        </div>
        <form className={styles.address} onSubmit={(event) => {
          event.preventDefault()
          try {
            const next = browserAddress(address)
            if (new URL(next).origin === window.location.origin) throw new Error('请在新标签页中打开 binOS 自身的网址')
            visit(next)
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : '网址格式不正确')
          }
        }}>
          <input
            aria-label="网址"
            placeholder="输入网址"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            onFocus={(event) => event.target.select()}
            type="text"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          <button type="submit" className={styles.go}>前往</button>
        </form>
        {url && <a className={styles.external} href={url} target="_blank" rel="noopener noreferrer" aria-label="在新标签页打开输入的网址" title="在新标签页打开输入的网址"><ArrowUpRight size={17} strokeWidth={1.75} /></a>}
      </div>
      {error && <p className={styles.error} role="alert">{error}</p>}
      {insecure ? (
        <div className={styles.home}>
          <Globe size={40} strokeWidth={1.5} />
          <h1>无法嵌入 HTTP 网页</h1>
          <p>浏览器会拦截 HTTPS 页面中嵌入的 HTTP 网页。请切换到远程模式，或在新标签页打开。</p>
        </div>
      ) : url ? (
        <>
          <div className={styles.notice}>
            地址栏和前后退仅记录输入的网址，网页内跳转不会同步。若网站拒绝嵌入或无法登录，可在新标签页打开。
          </div>
          <iframe
            key={`${url}:${revision}`}
            className={styles.frame}
            src={url}
            title={`网页：${url}`}
            sandbox={sandbox}
            referrerPolicy="no-referrer"
            allow="fullscreen"
          />
        </>
      ) : (
        <div className={styles.home}>
          <Globe size={40} strokeWidth={1.5} />
          <h1>浏览器</h1>
          <p>在地址栏输入网址，直接在 binOS 中浏览网页。</p>
          <p>省略协议时使用 HTTPS，本机地址使用 HTTP。嵌入模式只能加载 HTTPS 和本机网址，部分网站也不允许嵌入，可切换到远程模式或在新标签页打开。</p>
        </div>
      )}
    </div>
  )
}

export function BrowserApp({ ctx }: { ctx: WindowContext }) {
  const [remote, setRemote] = useState(false)
  const remoteSession = useRef<string | undefined>(undefined)
  return <div className={styles.shell}>
    <div className={styles.modeBar} role="group" aria-label="浏览模式">
      <button type="button" className={styles.mode} aria-pressed={!remote} onClick={() => setRemote(false)}>嵌入模式</button>
      <button type="button" className={styles.mode} aria-pressed={remote} onClick={() => setRemote(true)}>远程模式</button>
    </div>
    <div className={styles.modeContent}>
      {remote ? <RemoteBrowser ctx={ctx} session={remoteSession} /> : <IframeBrowser ctx={ctx} />}
    </div>
  </div>
}
