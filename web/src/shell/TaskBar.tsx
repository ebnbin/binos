import { useEffect, useId, useRef, useState } from 'react'
import type { PointerEvent, PointerEventHandler, ReactNode, Ref } from 'react'
import { CircleArrowUp, ExternalLink, RefreshCw, X } from 'lucide-react'
import { findApplication, useApplications } from '../apps/index.ts'
import type { ConnectionState } from '../events.ts'
import { BrandMark } from '../ui/BrandMark.tsx'
import { Popover } from '../ui/Popover.tsx'
import { AppIcon } from './AppIcon.tsx'
import type { BarPlacement } from './bar-placement.ts'
import { layouts } from './layout.ts'
import type { LayoutId, SplitGroup } from './layout.ts'
import type { OpenWindow } from './state/types.ts'
import styles from './TaskBar.module.css'

// 菜单里的分屏和取消分屏：左右（竖屏时上下）各半，或者整块
function LayoutGlyph({ layout, portrait }: { layout: LayoutId; portrait: boolean }) {
  return (
    <span className={styles.glyph} data-portrait={portrait}>
      {layouts[layout].map((part, index) => (
        <i key={index} style={{ flex: part }} />
      ))}
    </span>
  )
}

const longPressDelay = 500
const longPressSlop = 10

const connectionLabels: Record<ConnectionState, string> = {
  connected: '已连接',
  connecting: '连接中',
  failed: '连接失败',
  offline: '设备离线',
  updated: '有新版本',
}

// 屏幕外面的 Dock：回到桌面（下面的点是连接状态，需要刷新时旁边有提示）、开着的 app。
// 窗口的操作（分屏、取消分屏、在新标签页打开、关闭）在 app 图标的菜单里：长按、右键，或者再点一次正在显示的图标
// 有 capsule 时 Dock 浮在屏幕底部之上，收起时只剩底部安全区里显示当前 app 或桌面的一颗胶囊
export function TaskBar({
  ref,
  capsule,
  connection,
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
  onUnsplit,
  onClose,
}: {
  ref?: Ref<HTMLElement>
  capsule?: {
    collapsed: boolean
    current?: OpenWindow
    onExpand: () => void
    onActivity: () => void
    onPointerDown: PointerEventHandler
    onPointerMove: PointerEventHandler
    onPointerEnd: () => void
    onMenu: (open: boolean) => void
  }
  connection: ConnectionState
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
  onUnsplit: (id: string) => void
  onClose: (id: string) => void
}) {
  const apps = useApplications()
  // 胶囊最前面是表示连接状态的圆点，然后在桌面上只有 binOS 的标志，在 app 里是 app 的图标和名字，不带窗口标题里的状态
  const capsuleApp = !home && capsule?.current ? findApplication(apps, capsule.current.window.applicationId) : undefined
  const capsuleName = capsuleApp?.name ?? '桌面'
  const dockId = useId()
  const dock = useRef<HTMLDivElement>(null)
  const capsuleButton = useRef<HTMLButtonElement>(null)
  // 用键盘展开或收起时，焦点跟着移到显示出来的那一边，不留在被隐藏的按钮上
  const moveFocus = useRef<'dock' | 'capsule' | null>(null)
  const collapsed = capsule?.collapsed
  // 连接状态是桌面按钮下面的点；连接失败或有新版本时，Dock 展开着就在桌面按钮旁边一直显示刷新的提示，不能关
  const attention = connection === 'failed' || connection === 'updated'
  const homeLabel = `桌面，${connectionLabels[connection]}`

  // 同一时间只开一个窗口菜单。触屏上点到菜单外面时，旧菜单要等这次触摸的 click 才关，
  // 那时可能已经长按打开了另一个，所以只关自己
  const [menu, setMenu] = useState<string | null>(null)
  const openMenu = (key: string | null) => {
    setMenu(key)
    capsule?.onMenu(key !== null)
  }
  // 往下滑收起 Dock 时菜单跟着关
  if (collapsed && menu) {
    setMenu(null)
  }
  const press = useRef<{ timer: number; x: number; y: number } | null>(null)
  // 长按打开菜单后松手的那次 click 不再当成点击
  const longPressed = useRef(false)
  const cancelPress = () => {
    if (press.current) window.clearTimeout(press.current.timer)
    press.current = null
  }
  const startPress = (key: string) => (event: PointerEvent) => {
    longPressed.current = false
    cancelPress()
    if (event.pointerType === 'mouse') return
    press.current = {
      x: event.clientX,
      y: event.clientY,
      timer: window.setTimeout(() => {
        press.current = null
        longPressed.current = true
        openMenu(key)
      }, longPressDelay),
    }
  }
  const movePress = (event: PointerEvent) => {
    const start = press.current
    if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > longPressSlop) cancelPress()
  }
  const sides = { bottom: 'top', left: 'right', right: 'left' } as const
  useEffect(() => {
    const target = moveFocus.current === 'dock'
      ? dock.current?.querySelector<HTMLElement>('[aria-pressed="true"]') ?? dock.current?.querySelector<HTMLElement>('button')
      : moveFocus.current === 'capsule' ? capsuleButton.current : null
    moveFocus.current = null
    target?.focus()
  }, [collapsed])
  const focusVisibleInside = (element: Element | null) => !!element?.contains(document.activeElement) && !!document.activeElement?.matches(':focus-visible')

  return (
    <nav
      ref={ref}
      inert={locked}
      className={styles.bar}
      data-placement={placement}
      data-compact={!!capsule}
      data-collapsed={collapsed}
      onPointerDown={capsule?.onPointerDown}
      onPointerMove={capsule?.onPointerMove}
      onPointerUp={capsule?.onPointerEnd}
      onPointerCancel={capsule?.onPointerEnd}
      onKeyDown={capsule?.onActivity}
    >
      {capsule && (
        <button
          ref={capsuleButton}
          type="button"
          className={styles.capsule}
          inert={!collapsed}
          aria-label={`${capsuleName}，${connectionLabels[connection]}，展开 Dock`}
          aria-expanded={false}
          aria-controls={dockId}
          onClick={(event) => {
            if (event.currentTarget.matches(':focus-visible')) moveFocus.current = 'dock'
            capsule.onExpand()
          }}
        >
          <span className={styles.connection} data-state={connection} />
          {capsuleApp ? <AppIcon app={capsuleApp} className={styles.capsuleIcon} /> : <BrandMark size={20} inverted />}
          {capsuleApp && <span className={styles.capsuleTitle}>{capsuleName}</span>}
        </button>
      )}
      <div ref={dock} id={dockId} className={styles.dock} inert={collapsed}>
        <span className={styles.homeSlot}>
          <button type="button" className={styles.item} aria-label={homeLabel} title={homeLabel} aria-pressed={home} onClick={onHome}>
            <BrandMark size={36} inverted />
            <span className={styles.connection} data-state={connection} />
          </button>
          {attention && (
            <button type="button" className={styles.notice} data-connection={connection} onClick={() => window.location.reload()}>
              {connection === 'failed' ? <RefreshCw size={20} strokeWidth={2} /> : <CircleArrowUp size={20} strokeWidth={2} />}
              <span className={styles.noticeText}>
                <strong>{connectionLabels[connection]}</strong>
                <small>{connection === 'failed' ? '刷新页面重新连接' : '刷新页面使用新版本'}</small>
              </span>
            </button>
          )}
        </span>
        {accessory}
        {windows.length > 0 && <span className={styles.separator} />}
        <div className={styles.apps}>
          {windows.filter((item) => {
            const group = groups.find((group) => group.slots.includes(item.id))
            return !group || group.slots[0] === item.id
          }).map((item) => {
            const group = groups.find((group) => group.slots.includes(item.id))
            const members = group ? group.slots.map((id) => windows.find((win) => win.id === id)!).filter(Boolean) : [item]
            const title = members.map((member) => member.title).join(' + ')
            const key = group?.id ?? item.id
            // 一组里在新标签页打开作用于聚焦的那个（没有聚焦的就是第一个），关闭是整组
            const target = members.find((member) => member.id === focused) ?? item
            const targetApp = findApplication(apps, target.window.applicationId)
            const pressed = !home && members.some((member) => member.id === focused)
            const choose = (action: () => void) => () => {
              openMenu(null)
              action()
            }
            return (
              <Popover
                key={key}
                label={`${title} 的窗口操作`}
                className={styles.menu}
                side={sides[placement]}
                align="center"
                open={menu === key}
                onOpenChange={(open) => {
                  if (open) openMenu(key)
                  else if (menu === key) openMenu(null)
                }}
                trigger={
                  <button
                    type="button"
                    className={styles.item}
                    data-group={!!group}
                    aria-label={title}
                    title={title}
                    aria-pressed={pressed}
                    data-visible={!home && members.some((member) => panes.includes(member.id))}
                    onPointerDown={startPress(key)}
                    onPointerMove={movePress}
                    onPointerUp={cancelPress}
                    onPointerCancel={cancelPress}
                    onContextMenu={(event) => {
                      event.preventDefault()
                      cancelPress()
                      openMenu(key)
                    }}
                    onClick={(event) => {
                      // 菜单的开关由这里决定，不交给 Popover 的触发按钮
                      event.preventDefault()
                      if (longPressed.current) {
                        longPressed.current = false
                        return
                      }
                      if (pressed) {
                        openMenu(menu === key ? null : key)
                        return
                      }
                      if (capsule && focusVisibleInside(dock.current)) moveFocus.current = 'capsule'
                      onShow(target.id)
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
                <div className={styles.menuLabel}>{title}</div>
                {group ? (
                  <button type="button" className={styles.menuItem} onClick={choose(() => onUnsplit(target.id))}>
                    <span className={styles.menuIcon}>
                      <LayoutGlyph layout="1" portrait={portrait} />
                    </span>
                    取消分屏
                  </button>
                ) : allowed.length > 1 && (
                  <button type="button" className={styles.menuItem} onClick={choose(() => onSplit(target.id))}>
                    <span className={styles.menuIcon}>
                      <LayoutGlyph layout="1:1" portrait={portrait} />
                    </span>
                    分屏
                  </button>
                )}
                {/* 外部 app 的窗口可以在新标签页打开，比如要在那里重新登录 */}
                {targetApp?.url && (
                  <button type="button" className={styles.menuItem} onClick={choose(() => window.open(targetApp.url, '_blank', 'noopener,noreferrer'))}>
                    <span className={styles.menuIcon}>
                      <ExternalLink size={18} strokeWidth={1.75} />
                    </span>
                    {group ? `在新标签页打开 ${targetApp.name}` : '在新标签页打开'}
                  </button>
                )}
                <button type="button" className={styles.menuItem} onClick={choose(() => onClose(target.id))}>
                  <span className={styles.menuIcon}>
                    <X size={18} strokeWidth={1.75} />
                  </span>
                  {group ? '全部关闭' : '关闭'}
                </button>
              </Popover>
            )
          })}
        </div>
      </div>
    </nav>
  )
}
