import { ArrowUpRightIcon, CheckIcon, DiscIcon, MagnifyingGlassIcon, MusicNoteIcon, PlaylistIcon, PlusIcon, SlidersHorizontalIcon, XIcon } from '@phosphor-icons/react'
import { useEffect, useRef, useState } from 'react'
import type { CatalogPage, Lyrics, ProviderInfo } from '@binos/server/apps/music/types'
import type { WindowContext } from '../types.ts'
import { trackKey } from './controller.ts'
import { PlayerControls } from './Controls.tsx'
import { music, useMusic, useQueueSync } from './store.ts'
import type { Track } from './types.ts'
import { catalog, readLyrics } from './api.ts'
import { useProviders, refreshProviders } from './providers.ts'
import { ProviderSettings } from './ProviderSettings.tsx'
import { PlaybackInspector } from './PlaybackInspector.tsx'
import { Select } from '../../ui/Select.tsx'
import styles from './music.module.css'

const inputOperation = (provider: ProviderInfo, query: string): 'search' | 'resolve' | 'playlist' => provider.input.references.find(rule => new RegExp(rule.pattern, 'i').test(query))?.capability ?? 'search'

export function MusicApp({ ctx }: { ctx: WindowContext }) {
  const state = useMusic()
  const queueStatus = useQueueSync()
  const track = state.queue[state.index]
  const { providers: musicProviders, error: providersError } = useProviders()
  const [providerId, setProviderId] = useState('')
  const provider = musicProviders.find(item => item.id === providerId) ?? musicProviders[0]
  const currentProvider = musicProviders.find(item => item.id === track?.ref.provider)
  const [lyrics, setLyrics] = useState<{ key: string; value: Lyrics }>()
  const lyricProvider = track?.ref.provider
  const lyricId = track?.ref.id
  const lyricKey = track ? trackKey(track) : ''
  const currentLyrics = lyrics?.key === lyricKey ? lyrics.value : undefined
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<CatalogPage>()
  const [tab, setTab] = useState<'queue' | 'results'>('queue')
  const [settings, setSettings] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const request = useRef<AbortController | null>(null)
  const submitted = useRef({ query: '', providerId: '', operation: 'search' as 'search' | 'resolve' | 'playlist' | 'recommendations' })
  const { setTitle } = ctx
  useEffect(() => { setTitle(track?.title ?? '') }, [track?.title, setTitle])
  useEffect(() => () => request.current?.abort(), [])

  async function search(more = false) {
    if (!provider) return
    const value = query.trim()
    if (!more && !value) return
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setBusy(true)
    setMessage('')
    setTab('results')
    const params = more ? submitted.current : { query: value, providerId: provider.id, operation: inputOperation(provider, value) }
    submitted.current = params
    if (!more) setResults(undefined)
    try {
      const page = await catalog(params.providerId, params.operation, params.query, more ? results?.nextPage : undefined, controller.signal)
      if (controller.signal.aborted) return
      setResults((previous) => ({ ...page, tracks: more ? [...(previous?.tracks ?? []), ...page.tracks] : page.tracks }))
      if (page.warning) setMessage(page.warning)
    } catch (error) {
      if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : '请求失败，请检查网络后重试。')
    } finally { if (!controller.signal.aborted) setBusy(false) }
  }

  const shown = tab === 'queue' ? state.queue : results?.tracks ?? []
  const queued = new Set(state.queue.map(trackKey))
  async function related() {
    if (!track) return
    request.current?.abort()
    const controller = new AbortController(); request.current = controller
    setBusy(true); setMessage(''); setTab('results'); setResults(undefined)
    submitted.current = { query: track.ref.id, providerId: track.ref.provider, operation: 'recommendations' }
    try { const page = await catalog(track.ref.provider, 'recommendations', track.ref.id, undefined, controller.signal); if (!controller.signal.aborted) setResults(page) }
    catch (error) { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : '无法读取推荐。') }
    finally { if (!controller.signal.aborted) setBusy(false) }
  }
  useEffect(() => {
    if (!lyricProvider || !lyricId || currentProvider?.capabilities.lyrics.state !== 'available') return
    const controller = new AbortController()
    readLyrics(lyricProvider, lyricId, controller.signal).then(value => { if (!controller.signal.aborted) setLyrics({ key: lyricKey, value }) }).catch(() => {})
    return () => controller.abort()
  }, [lyricProvider, lyricId, lyricKey, currentProvider?.capabilities.lyrics.state])
  if (!provider) return <div className={styles.empty}><p>{providersError ?? '正在读取音乐来源…'}</p>{providersError && <button type="button" onClick={() => void refreshProviders()}>重试</button>}</div>
  const operation = inputOperation(provider, query.trim())
  const resolving = operation !== 'search'
  const queryCapability = provider.capabilities[operation]

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <span className={styles.brand}>音乐</span>
        {musicProviders.length > 1 ? <Select className={styles.picker} label="音乐来源" value={provider.id} options={musicProviders.map((source) => ({ value: source.id, label: source.name }))} onValueChange={(value) => { request.current?.abort(); setBusy(false); setResults(undefined); setMessage(''); setProviderId(value) }} /> : <span className={styles.source}>{provider.name}</span>}
        {provider.configuration.fields.length > 0 && <button type="button" className={styles.iconButton} aria-label="音乐设置" title="音乐设置" aria-expanded={settings} onClick={() => setSettings(!settings)}><SlidersHorizontalIcon size={17} /></button>}
      </header>
      {settings && <ProviderSettings key={provider.id} provider={provider} />}
      <p className={styles.providerDescription}>{provider.description}</p>
      {providersError && <p className={styles.notice}>{providersError}</p>}
      <form className={styles.search} onSubmit={(event) => { event.preventDefault(); void search() }}>
        <MagnifyingGlassIcon size={14} />
        <input aria-label="搜索音乐或粘贴链接" placeholder="歌名、歌手或音乐链接" value={query} onChange={(event) => setQuery(event.target.value)} maxLength={500} />
        <button className={styles.primary} disabled={!query.trim() || queryCapability.state !== 'available'}>查找</button>
      </form>
      {queryCapability.state === 'configuration-required' && <p className={styles.providerDescription}>{queryCapability.reason}</p>}
      {queryCapability.state === 'unsupported' && <p className={styles.providerDescription}>此来源不支持{resolving ? '链接导入' : '搜索'}。</p>}
      <section className={styles.nowPlaying} aria-label="正在播放">
        <span className={styles.artwork}>{track?.artworkUrl ? <img src={track.artworkUrl} alt="" referrerPolicy="no-referrer" /> : <MusicNoteIcon size={44} weight="light" />}</span>
        <div className={styles.trackInfo}>
          <span className={styles.eyebrow}>{state.status === 'playing' ? '正在播放' : state.status === 'loading' ? '正在连接…' : state.status === 'error' ? '播放遇到问题' : track ? '随时继续' : '你的音乐，随时播放'}</span>
          <h1>{track?.title ?? '从喜欢的一首开始'}</h1>
          <p>{track ? track.artists.join(' / ') || '未知艺人' : '搜索喜欢的音乐，或粘贴单曲和歌单链接。'}</p>
          {track && <a href={track.externalUrl} target="_blank" rel="noreferrer" className={styles.trackLink}>在 {musicProviders.find((source) => source.id === track.ref.provider)?.name ?? track.ref.provider} 打开 <ArrowUpRightIcon size={12} /></a>}
        </div>
      </section>
      {state.error && <div role="alert" className={styles.error}>{state.error}</div>}
      <PlayerControls />
      {track && currentProvider?.capabilities.recommendations.state === 'available' && <button type="button" className={styles.textButton} disabled={busy} onClick={() => void related()}>发现相似歌曲</button>}
      {currentLyrics?.text && <details className={styles.lyrics}><summary>歌词</summary><p>{currentLyrics.text}</p>{currentLyrics.attribution && <small>{currentLyrics.attribution}</small>}</details>}
      <div className={styles.tabs}>
        <button type="button" data-active={tab === 'queue'} onClick={() => setTab('queue')}><PlaylistIcon size={14} />队列 <span>{state.queue.length}</span></button>
        <button type="button" data-active={tab === 'results'} onClick={() => setTab('results')}>查找结果{results && <span>{results.tracks.length}</span>}</button>
        <div className={styles.tabActions}>
          {tab === 'queue' && state.queue.length > 0 && <button type="button" onClick={() => music.clear()}>清空</button>}
          {tab === 'results' && shown.length > 0 && <button type="button" onClick={() => { music.add(shown); setTab('queue') }}>全部加入</button>}
        </div>
      </div>
      <div className={styles.content}>
        {message && <p className={styles.notice} role="status">{message}</p>}
        {shown.length === 0 ? <div className={styles.empty}><DiscIcon size={32} /><p>{busy ? '正在查找音乐…' : tab === 'queue' ? '播放队列还是空的' : results ? '没有找到内容，试试其他关键词或链接' : '搜索歌名，或粘贴音乐链接'}</p></div> : <ul className={styles.list}>
          {shown.map((item, index) => <TrackRow key={`${trackKey(item)}:${index}`} track={item} active={!!track && trackKey(item) === trackKey(track)} queued={queued.has(trackKey(item))} queue={tab === 'queue'} playable={musicProviders.find(source => source.id === item.ref.provider)?.capabilities.playback.state === 'available'} onPlay={() => tab === 'queue' ? void music.select(index) : music.add([item], true)} onAction={() => tab === 'queue' ? music.remove(index) : music.add([item])} />)}
        </ul>}
        {tab === 'results' && results?.nextPage && <button type="button" className={styles.loadMore} disabled={busy} onClick={() => void search(true)}>{busy ? '加载中…' : '加载更多'}</button>}
      </div>
      <footer className={styles.footer}><span>{state.queue.length >= 500 ? '队列已满（500 首）' : queueStatus}</span><PlaybackInspector engine={state.embedEngine} /></footer>
    </div>
  )
}

function TrackRow({ track, active, queued, queue, playable, onPlay, onAction }: { track: Track; active: boolean; queued: boolean; queue: boolean; playable: boolean; onPlay(): void; onAction(): void }) {
  return (
    <li className={styles.row} data-active={active}>
      <button type="button" className={styles.rowTrack} disabled={!playable} onClick={onPlay} title={`播放 ${track.title}`}>
        <span className={styles.thumb}>{track.artworkUrl ? <img src={track.artworkUrl} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <MusicNoteIcon size={16} />}</span>
        <span className={styles.rowInfo}><strong>{track.title}</strong><span>{track.artists.join(' / ') || '未知艺人'}</span></span>
      </button>
      <button type="button" className={styles.iconButton} aria-label={queue ? `移除 ${track.title}` : queued ? '已在队列中' : `加入队列 ${track.title}`} title={queue ? '移除' : queued ? '已在队列中' : '加入队列'} disabled={!queue && queued} onClick={onAction}>{queue ? <XIcon size={15} /> : queued ? <CheckIcon size={15} /> : <PlusIcon size={16} />}</button>
    </li>
  )
}
