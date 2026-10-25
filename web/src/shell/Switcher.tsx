import { useEffect, useEffectEvent, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent } from 'react'
import { X } from 'lucide-react'
import { findApplication, useApplications } from '../apps/index.ts'
import { AppIcon } from './AppIcon.tsx'
import type { SplitGroup } from './layout.ts'
import type { OpenWindow } from './state/types.ts'
import styles from './Switcher.module.css'

// target：点开时聚焦的窗口，分屏组里最近用过的那个
type Card = { key: string; target: string; members: OpenWindow[] }

function cardsOf(windows: OpenWindow[], groups: SplitGroup[], order: string[]): Card[] {
  const seen = new Set<string>()
  return order.flatMap((id) => {
    const group = groups.find((item) => item.slots.includes(id))
    const key = group?.id ?? id
    if (seen.has(key)) return []
    seen.add(key)
    const members = (group?.slots ?? [id]).flatMap((member) => windows.find((item) => item.id === member) ?? [])
    return members.length ? [{ key, target: id, members }] : []
  })
}

// 上滑超过这个距离，或者松手时还在快速上滑，就关掉
const dismissDistance = 120
const dismissVelocity = 0.6
// 先动了这么多才判断方向：竖着走是滑动关闭，横着走交给列表滚动
const slop = 8

type Drag = { pointer: number; x: number; y: number; active: boolean; lastY: number; lastTime: number; velocity: number }

function SwitcherCard({ card, onShow, onRemove }: { card: Card; onShow: (id: string) => void; onRemove: (id: string) => void }) {
  const apps = useApplications()
  const [offset, setOffset] = useState(0)
  const [closing, setClosing] = useState(false)
  const drag = useRef<Drag | null>(null)
  const dragged = useRef(false)
  const title = card.members.map((member) => member.title).join(' + ')

  const end = (event: PointerEvent) => {
    const current = drag.current
    if (!current || current.pointer !== event.pointerId) return
    drag.current = null
    if (!current.active) return
    if (event.type === 'pointerup' && (offset < -dismissDistance || (offset < -slop * 2 && current.velocity < -dismissVelocity))) setClosing(true)
    else setOffset(0)
  }

  return (
    <li
      className={styles.slot}
      data-card
      data-closing={closing}
      data-dragging={offset !== 0 && !closing}
      onPointerDown={(event) => {
        if (closing || event.button !== 0 || (event.target as Element).closest(`.${styles.close}`)) return
        dragged.current = false
        drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, active: false, lastY: event.clientY, lastTime: event.timeStamp, velocity: 0 }
      }}
      onPointerMove={(event) => {
        const current = drag.current
        if (!current || current.pointer !== event.pointerId) return
        const dx = event.clientX - current.x
        const dy = event.clientY - current.y
        if (!current.active) {
          if (Math.abs(dx) > slop && Math.abs(dx) > Math.abs(dy)) { drag.current = null; return }
          if (Math.abs(dy) <= slop) return
          current.active = true
          dragged.current = true
          event.currentTarget.setPointerCapture(event.pointerId)
        }
        const elapsed = event.timeStamp - current.lastTime
        if (elapsed > 0) current.velocity = (event.clientY - current.lastY) / elapsed
        current.lastY = event.clientY
        current.lastTime = event.timeStamp
        // 往下拉有阻力，只是跟手示意
        setOffset(dy < 0 ? dy : dy / 4)
      }}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <div
        className={styles.body}
        style={closing || offset === 0 ? undefined : { transform: `translateY(${offset}px)`, opacity: Math.max(0.3, 1 + offset / 400) }}
        onTransitionEnd={(event) => {
          if (closing && event.target === event.currentTarget && event.propertyName === 'opacity') onRemove(card.target)
        }}
      >
        <div className={styles.header}>
          <span className={styles.icons}>
            {card.members.map((member) => {
              const app = findApplication(apps, member.window.applicationId)
              return app && <AppIcon key={member.id} app={app} />
            })}
          </span>
          <span className={styles.title}>{title}</span>
          <button type="button" className={styles.close} aria-label={`关闭 ${title}`} title="关闭" onClick={() => setClosing(true)}>
            <X size={14} strokeWidth={2.5} />
          </button>
        </div>
        <button
          type="button"
          className={styles.card}
          aria-label={title}
          onClick={() => { if (!dragged.current) onShow(card.target) }}
        >
          {card.members.map((member) => {
            const app = findApplication(apps, member.window.applicationId)
            return (
              <span key={member.id} className={styles.pane}>
                {app && <AppIcon app={app} className={styles.backdrop} />}
                {app && <AppIcon app={app} className={styles.glyph} />}
              </span>
            )
          })}
        </button>
      </div>
    </li>
  )
}

// 窄屏的多任务视图：盖住屏幕，开着的窗口按最近用过排成一排卡片，点一张切过去，上滑或点 X 关掉。
// iframe 截不了图，卡片上是 app 图标，底色取自图标本身
export function Switcher({
  open, windows, groups, order, aspect, onShow, onRemove, onClose,
}: {
  open: boolean
  windows: OpenWindow[]
  groups: SplitGroup[]
  order: string[]
  aspect: number
  onShow: (id: string) => void
  onRemove: (id: string) => void
  onClose: () => void
}) {
  const list = useRef<HTMLOListElement>(null)
  const cards = cardsOf(windows, groups, order)
  const onEscape = useEffectEvent(onClose)

  useEffect(() => {
    if (!open) return
    const previous = document.activeElement
    const element = list.current
    element?.scrollTo({ left: 0 })
    element?.querySelector<HTMLElement>(`.${styles.card}`)?.focus({ preventScroll: true })
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onEscape() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      if (previous instanceof HTMLElement && element?.contains(document.activeElement)) previous.focus({ preventScroll: true })
    }
  }, [open])

  return (
    <div
      className={styles.switcher}
      data-open={open}
      inert={!open}
      role="dialog"
      aria-label="多任务"
      style={{ '--aspect': aspect } as CSSProperties}
      onClick={(event) => { if (!(event.target as Element).closest('[data-card]')) onClose() }}
    >
      <ol ref={list} className={styles.list} aria-label="开着的窗口">
        {cards.map((card) => (
          <SwitcherCard key={card.key} card={card} onShow={onShow} onRemove={onRemove} />
        ))}
      </ol>
    </div>
  )
}
