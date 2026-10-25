import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ExternalLink, X } from 'lucide-react'
import { findApplication, useApplications } from '../apps/index.ts'
import { BrandMark } from '../ui/BrandMark.tsx'
import { Popover } from '../ui/Popover.tsx'
import { AppIcon } from './AppIcon.tsx'
import type { BarPlacement } from './bar-placement.ts'
import { useDockGesture } from './dock-gesture.ts'
import { layouts } from './layout.ts'
import type { LayoutId, SplitGroup } from './layout.ts'
import type { OpenWindow } from './state/types.ts'
import styles from './TaskBar.module.css'

// 分屏：左右（竖屏时上下）各半
function SplitGlyph({ portrait }: { portrait: boolean }) {
  return (
    <span className={styles.glyph} data-portrait={portrait}>
      {layouts['1:1'].map((part, index) => (
        <i key={index} style={{ flex: part }} />
      ))}
    </span>
  )
}

// 屏幕外面的 Dock：回到桌面、开着的 app，只负责导航。窗口的操作在 app 图标的菜单里：再点一次聚焦的图标、长按或右键打开
export function TaskBar({
  placement,
  accessory,
  windows,
  groups,
  locked,
  panes,
  focused,
  home,
  allowed,
  portrait,
  onHome,
  onShow,
  onSplit,
  onClose,
}: {
  placement: Exclude<BarPlacement, 'hidden'>
  accessory?: ReactNode
  windows: OpenWindow[]
  groups: SplitGroup[]
  locked: boolean
  panes: (string | null)[]
  focused: string | null
  home: boolean
  allowed: LayoutId[]
  portrait: boolean
  onHome: () => void
  onShow: (id: string) => void
  onSplit: (id: string) => void
  onClose: (id: string) => void
}) {
  const apps = useApplications()
  const [menu, setMenu] = useState<string | null>(null)
  const list = useRef<HTMLDivElement>(null)
  const [overflows, setOverflows] = useState(false)
  useEffect(() => {
    const element = list.current
    if (!element) return
    const update = () => setOverflows(element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [windows.length, placement])

  // 分屏的一组在 Dock 上是一项；点它显示组里聚焦的那个，没有聚焦的就显示第一个
  const items = windows.filter((item) => {
    const group = groups.find((group) => group.slots.includes(item.id))
    return !group || group.slots[0] === item.id
  }).map((item) => {
    const group = groups.find((group) => group.slots.includes(item.id))
    const members = group ? group.slots.map((id) => windows.find((win) => win.id === id)!).filter(Boolean) : [item]
    const target = members.find((member) => member.id === focused) ?? item
    return { key: group?.id ?? item.id, group, members, target }
  })
  const current = items.findIndex((item) => item.members.some((member) => member.id === focused))

  const gesture = useDockGesture({
    placement,
    scrolls: (target) => overflows && !!list.current?.contains(target),
    onStep: (steps) => {
      const next = current < 0 ? (steps > 0 ? 0 : items.length - 1) : Math.min(items.length - 1, Math.max(0, current + steps))
      const item = items[next]
      if (item && (home || next !== current)) onShow(item.target.id)
    },
    onHome,
    onLongPress: (target) => {
      const key = target.closest<HTMLElement>('[data-window]')?.dataset.window
      if (key) setMenu(key)
      return !!key
    },
  })

  const sides = { bottom: 'top', left: 'right', right: 'left' } as const

  return (
    <nav inert={locked} className={styles.bar} data-placement={placement}>
      <div className={styles.dock} data-scrolls={overflows} {...gesture} onContextMenu={(event) => event.preventDefault()}>
        <button type="button" className={styles.item} aria-label="桌面" title="桌面" aria-pressed={home} onClick={onHome}>
          <BrandMark size={30} inverted />
        </button>
        {accessory}
        {windows.length > 0 && <span className={styles.separator} />}
        <div ref={list} className={styles.apps}>
          {items.map(({ key, group, members, target }) => {
            const title = members.map((member) => member.title).join(' + ')
            const pressed = !home && members.some((member) => member.id === focused)
            // 外部 app 的窗口可以在新标签页打开，比如要在那里重新登录
            const url = findApplication(apps, target.window.applicationId)?.url
            const choose = (action: () => void) => () => {
              setMenu(null)
              action()
            }
            return (
              <Popover
                key={key}
                label={`${target.title} 的窗口操作`}
                className={styles.menu}
                side={sides[placement]}
                align="center"
                open={menu === key}
                onOpenChange={(open) => setMenu(open ? key : null)}
                trigger={
                  <button
                    type="button"
                    className={styles.item}
                    data-window={key}
                    data-group={!!group}
                    aria-label={title}
                    title={title}
                    aria-pressed={pressed}
                    data-visible={!home && members.some((member) => panes.includes(member.id))}
                    onClick={(event) => {
                      // 菜单的开关由这里决定，不交给 Popover 的触发按钮
                      event.preventDefault()
                      if (pressed) setMenu(menu === key ? null : key)
                      else onShow(target.id)
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault()
                      setMenu(key)
                    }}
                  >
                    {members.map((member) => {
                      const app = findApplication(apps, member.window.applicationId)
                      return app && (
                        <span key={member.id} className={styles.member} data-focused={!!group && !home && member.id === focused}>
                          <AppIcon app={app} />
                        </span>
                      )
                    })}
                  </button>
                }
              >
                <div className={styles.menuLabel}>{target.title}</div>
                {!group && allowed.length > 1 && (
                  <button type="button" className={styles.menuItem} onClick={choose(() => onSplit(target.id))}>
                    <span className={styles.menuIcon}>
                      <SplitGlyph portrait={portrait} />
                    </span>
                    分屏
                  </button>
                )}
                {url && (
                  <button type="button" className={styles.menuItem} onClick={choose(() => window.open(url, '_blank', 'noopener,noreferrer'))}>
                    <span className={styles.menuIcon}>
                      <ExternalLink size={18} strokeWidth={1.75} />
                    </span>
                    在新标签页打开
                  </button>
                )}
                <button type="button" className={styles.menuItem} onClick={choose(() => onClose(target.id))}>
                  <span className={styles.menuIcon}>
                    <X size={18} strokeWidth={1.75} />
                  </span>
                  关闭
                </button>
              </Popover>
            )
          })}
        </div>
      </div>
    </nav>
  )
}
