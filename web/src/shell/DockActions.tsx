import { useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ExternalLink, Undo2, X } from 'lucide-react'
import { findApplication, useApplications } from '../apps/index.ts'
import { AppIcon } from './AppIcon.tsx'
import type { BarPlacement } from './bar-placement.ts'
import { layouts } from './layout.ts'
import type { LayoutId } from './layout.ts'
import type { OpenWindow } from './state/types.ts'
import styles from './DockActions.module.css'
import { dropKey } from './drop-target.ts'
import type { DropTarget } from './drop-target.ts'

type Rect = { left: number; top: number; width: number; height: number }

// 长按 Dock 上的 app 图标后出现：贴着 Dock 的一排操作，能分屏时屏幕上方分成两块。
// 拖着图标放到哪里就做什么；长按后直接松手就留着，点哪个做哪个
export function DockActions({
  members, group, placement, origin, dock, screen, split, partner, pointer, hover, onChoose,
}: {
  members: OpenWindow[]
  group: boolean
  placement: Exclude<BarPlacement, 'hidden'>
  origin: Rect
  dock: Rect
  screen: Rect
  // 能分屏时的布局和方向
  split?: { layout: LayoutId; portrait: boolean }
  // 正在显示的另一个窗口：和它直接分屏，默认它在前、按住的在后；没有就必须选一侧，另一侧再选一个 app
  partner?: OpenWindow
  // 拖动中手指的位置；直接松手后是 null
  pointer: { x: number; y: number } | null
  hover: string | null
  onChoose: (target: DropTarget) => void
}) {
  const apps = useApplications()
  const app = (member: OpenWindow) => findApplication(apps, member.window.applicationId)
  const name = (member: OpenWindow) => app(member)?.name ?? member.title
  const actions: { target: DropTarget; icon: ReactNode; label: string }[] = [
    { target: { type: 'cancel' }, icon: <Undo2 size={18} strokeWidth={2} />, label: '取消' },
    ...(group ? [{ target: { type: 'unsplit' } as DropTarget, icon: <span className={styles.single} />, label: '取消分屏' }] : []),
    ...(split && partner ? [{
      target: { type: 'split', at: 1 } as DropTarget,
      icon: <span className={styles.halves} data-portrait={split.portrait}><i /><i /></span>,
      label: `和 ${name(partner)} 分屏`,
    }] : []),
    ...members.map((member) => ({ target: { type: 'close', id: member.id } as DropTarget, icon: <X size={18} strokeWidth={2} />, label: group ? `关闭 ${name(member)}` : '关闭' })),
    ...members.filter((member) => app(member)?.url).map((member) => ({
      target: { type: 'external', id: member.id } as DropTarget, icon: <ExternalLink size={18} strokeWidth={2} />, label: group ? `在新标签页打开 ${name(member)}` : '在新标签页打开',
    })),
  ]

  // 一排操作以按住的图标为中心，靠边时往里挪；分屏的两块在它和 Dock 以外的屏幕上
  const bar = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  useLayoutEffect(() => {
    const element = bar.current
    if (element) setSize({ width: element.offsetWidth, height: element.offsetHeight })
  }, [actions.length])
  const gap = 12
  const side = placement !== 'bottom'
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
  const barPosition = size && (side
    ? {
      left: placement === 'right' ? dock.left - gap - size.width : dock.left + dock.width + gap,
      top: clamp(origin.top + origin.height / 2 - size.height / 2, screen.top + gap, screen.top + screen.height - gap - size.height),
    }
    : {
      left: clamp(origin.left + origin.width / 2 - size.width / 2, screen.left + gap, screen.left + screen.width - gap - size.width),
      top: Math.min(dock.top, screen.top + screen.height) - gap - size.height,
    })
  const area: Rect | null = barPosition && size && (side
    ? placement === 'right'
      ? { left: screen.left + gap, top: screen.top + gap, width: barPosition.left - gap - screen.left - gap, height: screen.height - gap * 2 }
      : { left: barPosition.left + size.width + gap, top: screen.top + gap, width: screen.left + screen.width - gap - (barPosition.left + size.width + gap), height: screen.height - gap * 2 }
    : { left: screen.left + gap, top: screen.top + gap, width: screen.width - gap * 2, height: barPosition.top - gap - screen.top - gap })
  const zones = split && area ? zoneRects(area, layouts[split.layout], split.portrait) : []
  const hovered = zones.findIndex((_, at) => hover === dropKey({ type: 'split', at }))

  const dragging = pointer !== null
  return createPortal(
    <div className={styles.layer} data-dragging={dragging} onPointerDown={(event) => {
      if (event.target === event.currentTarget) onChoose({ type: 'cancel' })
    }}>
      {zones.map((rect, at) => {
        const target: DropTarget = { type: 'split', at }
        // 按住的放在哪一侧：拖到的那一块；没拖到时有 partner 就按默认放在后面，否则还没定
        const placed = hovered >= 0 ? hovered : partner ? 1 : null
        const shown = placed === null ? null : placed === at ? members[0] : partner ?? null
        const label = placed === null ? '分屏到这里' : shown ? name(shown) : '再选一个 app'
        return (
          <button key={at} type="button" className={styles.zone} data-drop={dropKey(target)} data-active={hovered === at}
            style={rect} onClick={() => onChoose(target)}>
            {shown && app(shown) && <AppIcon app={app(shown)!} className={styles.zoneIcon} />}
            <span>{label}</span>
          </button>
        )
      })}
      <div ref={bar} className={styles.actions} data-side={side} role="menu" aria-label={`${members.map(name).join(' + ')} 的操作`}
        style={barPosition ?? { visibility: 'hidden' }}>
        {actions.map(({ target, icon, label }) => (
          <button key={dropKey(target)} type="button" role="menuitem" className={styles.action} data-drop={dropKey(target)}
            data-active={hover === dropKey(target)} data-type={target.type} onClick={() => onChoose(target)}>
            {icon}
            <span>{label}</span>
          </button>
        ))}
      </div>
      {pointer && (
        <div className={styles.ghost} style={{ left: pointer.x, top: pointer.y }} data-group={group}>
          {members.map((member) => app(member) && <AppIcon key={member.id} app={app(member)!} />)}
        </div>
      )}
    </div>,
    document.body,
  )
}

// 按布局的比例把区域切成两块，中间留一条缝
function zoneRects(area: Rect, parts: number[], portrait: boolean): Rect[] {
  const gap = 8
  const total = parts.reduce((sum, part) => sum + part, 0)
  const length = (portrait ? area.height : area.width) - gap * (parts.length - 1)
  let start = portrait ? area.top : area.left
  return parts.map((part) => {
    const extent = length * part / total
    const rect = portrait
      ? { left: area.left, top: start, width: area.width, height: extent }
      : { left: start, top: area.top, width: extent, height: area.height }
    start += extent + gap
    return rect
  })
}
