import { createPortal } from 'react-dom'
import { findApplication, useApplications } from '../apps/index.ts'
import { AppIcon } from './AppIcon.tsx'
import type { BarPlacement } from './bar-placement.ts'
import { layouts } from './layout.ts'
import type { LayoutId } from './layout.ts'
import type { OpenWindow } from './state/types.ts'
import styles from './DockSplit.module.css'

type Rect = { left: number; top: number; width: number; height: number }

// 长按 Dock 上能分屏的 app 图标后拖着它排布：屏幕上原来的内容拿走，分成和分屏布局一样的两块，
// 拖到哪一块就分屏到哪一侧。Dock 旁边留一段空白，放在那里就是取消
export function DockSplit({ held, placement, dock, screen: screenElement, split, partner, pointer, hover }: {
  held: OpenWindow
  placement: Exclude<BarPlacement, 'hidden'>
  dock: Rect
  screen: HTMLElement
  split: { layout: LayoutId; portrait: boolean }
  // 正在显示的另一个窗口：和它直接分屏，它默认在前；没有就是另一侧再选一个 app
  partner?: OpenWindow
  pointer: { x: number; y: number }
  // 手指下面的那一块
  hover: number | null
}) {
  const apps = useApplications()
  const app = (member: OpenWindow) => findApplication(apps, member.window.applicationId)

  const screen = screenElement.getBoundingClientRect()
  const gap = 12
  const neutral = 64
  const area: Rect = placement === 'right'
    ? { left: screen.left + gap, top: screen.top + gap, width: dock.left - neutral - screen.left - gap, height: screen.height - gap * 2 }
    : placement === 'left'
      ? { left: dock.left + dock.width + neutral, top: screen.top + gap, width: screen.left + screen.width - gap - (dock.left + dock.width + neutral), height: screen.height - gap * 2 }
      : { left: screen.left + gap, top: screen.top + gap, width: screen.width - gap * 2, height: Math.min(dock.top, screen.top + screen.height) - neutral - screen.top - gap }
  const zones = zoneRects(area, layouts[split.layout], split.portrait)

  return (
    <>
      {/* 盖在屏幕里，浮在屏幕之上的 Dock 不被盖住 */}
      {createPortal(<div className={styles.arranging} />, screenElement)}
      {createPortal(
        <div className={styles.layer}>
          {zones.map((rect, at) => {
            // 按住的只在拖到的那一块上出现；正在显示的 partner 没拖动时留在前面，拖到前面时换到后面
            const shown = hover === null ? (at === 0 ? partner ?? null : null) : hover === at ? held : partner ?? null
            const shownApp = shown && app(shown)
            return (
              <div key={at} className={styles.zone} data-split={at} data-active={hover === at} style={rect}>
                {shownApp && <AppIcon app={shownApp} className={styles.zoneIcon} />}
                <span>{shownApp ? shownApp.name : hover === null ? '分屏到这里' : '再选一个 app'}</span>
              </div>
            )
          })}
          <div className={styles.ghost} style={{ left: pointer.x, top: pointer.y }}>
            {app(held) && <AppIcon app={app(held)!} />}
          </div>
        </div>,
        document.body,
      )}
    </>
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
