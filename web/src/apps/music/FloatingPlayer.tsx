import { DiscIcon, DotsSixIcon, MinusIcon, MusicNoteIcon, StopIcon } from '@phosphor-icons/react'
import { useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import { useElementSize } from '../../ui/useElementSize.ts'
import { Transport } from './Controls.tsx'
import { floatingBounds, floatingOffset, moveFloating, restorePosition } from './floatingPosition.ts'
import type { Dimensions, Position } from './floatingPosition.ts'
import { music, useMusic } from './store.ts'
import styles from './FloatingPlayer.module.css'

const storageKey = 'binos:music:floating-position'
const labels = { idle: '已停止', loading: '正在连接…', playing: '正在播放', paused: '已暂停', ended: '播放结束', error: '播放遇到问题' }
function readPosition(): Position {
  try { return restorePosition(JSON.parse(localStorage.getItem(storageKey) ?? 'null')) }
  catch { return restorePosition(null) }
}
function savePosition(position: Position) {
  try { localStorage.setItem(storageKey, JSON.stringify(position)) } catch { /* The player can still be moved without storage. */ }
}

export function MusicStatusButton({ collapsed, onToggle }: { collapsed: boolean; onToggle(): void }) {
  const state = useMusic()
  const track = state.queue[state.index]
  if (!track || state.status === 'idle') return null
  return (
    <button type="button" className={styles.statusButton} aria-label={collapsed ? '显示音乐播放器' : '收起音乐播放器'} aria-expanded={!collapsed} title={`${track.title} · ${labels[state.status]}`} onClick={onToggle}>
      <MusicNoteIcon size={20} />
      {(state.status === 'playing' || state.status === 'loading') && <span className={styles.playingDot} />}
    </button>
  )
}

export function FloatingPlayer({ screen, collapsed, onCollapse, onOpen, locked }: { screen: Dimensions; collapsed: boolean; onCollapse(): void; onOpen(): void; locked: boolean }) {
  const state = useMusic()
  if (collapsed || !state.queue[state.index] || state.status === 'idle') return null
  return <PlayerPanel screen={screen} onCollapse={onCollapse} onOpen={onOpen} locked={locked} />
}

function PlayerPanel({ screen, onCollapse, onOpen, locked }: { screen: Dimensions; onCollapse(): void; onOpen(): void; locked: boolean }) {
  const state = useMusic()
  const track = state.queue[state.index]!
  const [panel, size] = useElementSize<HTMLElement>()
  const [position, setPosition] = useState(readPosition)
  const current = useRef(position)
  const drag = useRef<{ pointer: number; x: number; y: number; position: Position } | null>(null)
  const bounds = floatingBounds(screen, size ?? { width: Math.min(320, screen.width - 24), height: 158 })
  const offset = floatingOffset(position, bounds)
  const update = (next: Position) => { current.current = next; setPosition(next) }
  const finish = () => { if (drag.current) { drag.current = null; savePosition(current.current) } }
  const move = (event: PointerEvent) => {
    const start = drag.current
    if (!start || start.pointer !== event.pointerId) return
    update(moveFloating(start.position, { x: event.clientX - start.x, y: event.clientY - start.y }, bounds))
  }

  return (
    <section ref={panel} aria-label="音乐悬浮播放器" className={styles.panel} inert={locked} style={{ left: offset.x, top: offset.y }}>
      <header className={styles.header}>
        <button
          type="button" className={styles.grip} aria-label="移动音乐播放器" title="拖动移动，或使用方向键"
          onPointerDown={event => {
            if (event.button !== 0 || !event.isPrimary) return
            event.preventDefault()
            event.currentTarget.setPointerCapture(event.pointerId)
            drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, position: current.current }
          }}
          onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}
          onKeyDown={event => {
            const delta = { ArrowLeft: { x: -16, y: 0 }, ArrowRight: { x: 16, y: 0 }, ArrowUp: { x: 0, y: -16 }, ArrowDown: { x: 0, y: 16 } }[event.key]
            if (!delta) return
            event.preventDefault()
            const next = moveFloating(current.current, delta, bounds)
            update(next)
            savePosition(next)
          }}
        ><DotsSixIcon size={14} /><span>{labels[state.status]}</span></button>
        <button type="button" className={styles.iconButton} aria-label="停止播放" title="停止播放" onClick={() => music.stop()}><StopIcon size={11} weight="fill" /></button>
        <button type="button" className={styles.iconButton} aria-label="收起音乐播放器" title="收起，音乐继续播放" onClick={onCollapse}><MinusIcon size={15} /></button>
      </header>
      <button type="button" className={styles.info} aria-label="打开音乐 App" onClick={onOpen}>
        <span className={styles.artwork}>{track.artworkUrl ? <img src={track.artworkUrl} alt="" referrerPolicy="no-referrer" /> : <DiscIcon size={28} />}</span>
        <span className={styles.text}><strong>{track.title}</strong><span>{track.artists.join(' / ') || '未知艺人'}</span></span>
      </button>
      {state.error && <p className={styles.error} role="alert">{state.error}</p>}
      <div className={styles.transport}><Transport compact /></div>
      <div className={styles.progress} aria-hidden="true"><span style={{ width: `${state.durationMs ? Math.min(100, state.positionMs / state.durationMs * 100) : 0}%` }} /></div>
    </section>
  )
}
