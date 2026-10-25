import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Build, InstallLink, Target } from '@binos/server/apps/builds/types'
import { errorMessage } from '../../api.ts'
import { RefreshCw } from 'lucide-react'
import { Select } from '../../ui/Select.tsx'
import styles from './builds.module.css'
import { buildsBase as base, buildsRequest as request, useBuilds } from './useBuilds.ts'
const targetLabels: Record<Target, string> = { web: 'Web', android: 'Android', ios: 'iOS' }
const statusLabels = { queued: '排队中', running: '构建中', success: '成功', failed: '失败', cancelled: '已取消', interrupted: '已中断' }
const formatSize = (bytes: number) => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
type Group = { key: string; kind: 'main' | 'pr' | 'manual'; pr?: number; commits: Build[][] }
// 按来源分组：main、每个 PR（包括手动指定 pr/编号 的）、其余手动构建；组内按提交分，最新的在前
function groupBuilds(builds: Build[]) {
  const groups = new Map<string, Group>()
  for (const b of builds) {
    const kind = b.trigger === 'main' ? 'main' : b.pr ? 'pr' : 'manual'
    const key = kind === 'pr' ? `pr-${b.pr}` : kind
    const group = groups.get(key) ?? groups.set(key, { key, kind, pr: b.pr, commits: [] }).get(key)!
    const commit = group.commits.find((c) => c[0].commit === b.commit)
    if (commit) commit.push(b); else group.commits.push([b])
  }
  return [...groups.values()]
}
export function BuildsPage({ initialRef = 'main' }: { initialRef?: string }) {
  const { data, error, setError, update } = useBuilds()
  const [busy, setBusy] = useState(false)
  const [ref, setRef] = useState(initialRef)
  const [target, setTarget] = useState('both')
  const [filter, setFilter] = useState(initialRef.startsWith('pr/') ? 'pr' : 'all')
  const [log, setLog] = useState<Build>()
  const [text, setText] = useState('')
  const [clock, setClock] = useState(() => Date.now())
  const running = Boolean(data?.builds.some((b) => b.status === 'running'))
  useEffect(() => { if (!running) return; const timer = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(timer) }, [running])
  // 日志不在通知里：没编完时定时重读，编完再读最后一次
  const logStatus = data?.builds.find((b) => b.id === log?.id)?.status
  const logLive = logStatus === 'queued' || logStatus === 'running'
  useEffect(() => {
    if (!log) return
    let active = true
    const read = async () => { try { const r = await fetch(`${base}/${log.id}/log`); if (!r.ok) throw new Error('日志读取失败'); const value = await r.text(); if (active) setText(value) } catch (e) { if (active) setText(String(e)) } }
    void read(); const timer = logLive ? setInterval(() => void read(), 2000) : undefined
    return () => { active = false; clearInterval(timer) }
  }, [log, logLive])
  // 报错一般在最后：打开时滚到末尾，停在末尾时跟着新内容走，往上翻看时不打断
  const pre = useRef<HTMLPreElement>(null)
  const follow = useRef(true)
  useEffect(() => { follow.current = true }, [log])
  useLayoutEffect(() => { const el = pre.current; if (el && follow.current) el.scrollTop = el.scrollHeight }, [text])
  async function install(id: string) {
    setBusy(true)
    try {
      const r = await fetch(`${base}/${id}/install`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
      if (!r.ok) throw new Error(await errorMessage(r, '无法创建安装链接'))
      window.location.assign(((await r.json()) as InstallLink).url)
    } catch (e) { setError(String(e)) } finally { setBusy(false) }
  }
  // 预览链接指向 PR 当前的预览，只在开着的 PR 最新一次成功的 Web 构建上显示
  const live = new Set(data?.prs?.flatMap((pr) => data.builds.find((b) => b.target === 'web' && b.pr === pr.number && b.status === 'success')?.id ?? []))
  function card(b: Build) {
    return <article className={styles.build} key={b.id}>
      <div className={styles.buildTitle}><strong>{targetLabels[b.target]}</strong><span className={styles.badge} data-status={b.status}>{statusLabels[b.status]}</span><span className={styles.spacer} /><code title={b.commit}>{b.commit.slice(0, 7)}</code>{b.trigger === 'manual' && b.pr && <span className={styles.trigger}>手动</span>}</div>
      <small className={styles.meta}>{[
        new Date(b.createdAt).toLocaleString(),
        b.startedAt && `用时 ${Math.max(0, Math.round(((b.endedAt ? Date.parse(b.endedAt) : clock) - Date.parse(b.startedAt)) / 1000))} 秒`,
        ...b.artifacts.map((a) => a.kind === 'link' ? new URL(a.url).host : `${a.name} · ${formatSize(a.size)}`),
      ].filter(Boolean).join(' · ')}</small>
      {b.error && <p className={styles.error}>{b.error}</p>}
      {/* 产物按钮跟在操作后面：Android 下载安装包，iOS 无线安装（下载的 IPA 在设备上装不上），Web 打开预览 */}
      <div className={styles.actions}>
        <button className={styles.button} onClick={() => { setText('读取日志…'); setLog(b) }}>查看日志</button>
        {['queued', 'running'].includes(b.status) ? <button className={styles.destructive} disabled={busy} onClick={() => void act({ action: 'cancel', id: b.id })}>取消</button> : <button className={styles.button} disabled={busy} onClick={() => void act({ action: 'retry', id: b.id })}>重新构建</button>}
        {b.artifacts.map((a) => a.kind === 'link'
          ? live.has(b.id) && <a className={styles.tinted} key={a.name} href={a.url} target="_blank" rel="noreferrer">打开预览 ↗</a>
          : a.platform === 'android'
            ? <a className={styles.tinted} key={a.name} href={`${base}/${b.id}/artifacts/${encodeURIComponent(a.name)}`} download title={`SHA-256: ${a.sha256}`}>下载</a>
            : data?.mode === 'real' && <button className={styles.tinted} key={a.name} disabled={busy} onClick={() => void install(b.id)} title="仅限描述文件内已注册的设备，安装链接有效期 24 小时">安装</button>)}
      </div>
    </article>
  }
  async function act(body: unknown) { setBusy(true); try { update(await request(body)); setError('') } catch (e) { setError(String(e)) } finally { setBusy(false) } }
  return <section className={styles.page}>
    <div className={styles.content}>
    <header className={styles.header}><div><h1>构建</h1><p>Android 与 iOS 的持续集成、日志和产物</p></div><button className={styles.glassButton} disabled={busy} onClick={() => void act({ action: 'poll' })}><RefreshCw size={14} strokeWidth={2} />检查更新</button></header>
    {data?.mode === 'mock' && <p className={styles.notice}>预览模式：模拟构建，与正式构建及签名隔离。</p>}
    {error && <p role="alert" className={styles.alert}>{error}</p>}
    {data?.pollError && <p role="alert" className={styles.alert}>检查仓库失败：{data.pollError}</p>}
    {data && <div className={styles.block}><div className={styles.group}>
      <label className={styles.row}>自动构建 main 和 PR<input className={styles.switch} type="checkbox" role="switch" checked={data.settings.automatic} disabled={busy} onChange={(e) => void act({ action: 'settings', automatic: e.target.checked })} /></label>
    </div>{data.checkedAt && <small className={styles.footer}>上次检查：{new Date(data.checkedAt).toLocaleString()}</small>}</div>}
    <form className={styles.block} onSubmit={(e) => { e.preventDefault(); void act({ action: 'enqueue', ref: ref.trim(), targets: target === 'both' ? ['android', 'ios'] : [target] }) }}>
      <div className={styles.group}>
        <label className={styles.row}>构建来源<input className={styles.field} aria-label="构建来源" required value={ref} onChange={(e) => setRef(e.target.value)} placeholder="main、pr/编号、完整提交号" /></label>
        <div className={styles.row}>构建目标<Select label="构建目标" value={target} onValueChange={setTarget} options={[{ value: 'both', label: 'Android + iOS' }, ...Object.entries(targetLabels).map(([key, label]) => ({ value: key, label }))]} /></div>
        <div className={styles.submitRow}><button className={styles.prominent} disabled={busy || !data} type="submit">开始构建</button></div>
      </div>
    </form>
    <nav className={styles.filters} aria-label="构建筛选">{[['all', '全部'], ['main', 'main'], ['pr', 'PR'], ['manual', '手动']].map(([key, label]) => <button className={styles.segment} key={key} aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</button>)}</nav>
    {!data ? <p className={styles.empty}>正在连接构建服务…</p> : !data.builds.length ? <p className={styles.empty}>暂无构建。提交包含移动端构建脚本后将自动构建，也可以手动指定来源。</p> : groupBuilds(data.builds).filter((g) => filter === 'all' || g.kind === filter).map((g) => {
      const title = data.prs?.find((pr) => pr.number === g.pr)?.title
      const closed = g.pr && data.prs && !title
      const [latest, ...older] = g.commits
      return <section className={styles.section} key={g.key}>
        <h2 className={styles.groupHeader}>{g.kind === 'main' ? 'main' : g.kind === 'manual' ? '手动' : <>PR #{g.pr}{title && ` ${title}`}{closed && <span className={styles.closed}>已合并或关闭</span>}</>}</h2>
        <div className={styles.list}>{latest.map(card)}</div>
        {older.length > 0 && <details className={styles.older}><summary>更早的 {older.length} 个提交</summary><div className={styles.list}>{older.flat().map(card)}</div></details>}
      </section>
    })}
    </div>
    {log && <section className={styles.log} aria-label="构建日志"><header><strong>{targetLabels[log.target]} · {log.commit.slice(0, 7)}</strong><a className={styles.link} href={`${base}/${log.id}/log?download=1`} download>下载完整日志</a><button className={styles.button} onClick={() => setLog(undefined)}>关闭日志</button></header><pre ref={pre} onScroll={(e) => { const el = e.currentTarget; follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24 }}>{text}</pre></section>}
  </section>
}
