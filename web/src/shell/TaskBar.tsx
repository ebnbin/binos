import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { PointerEvent, PointerEventHandler, ReactNode, Ref } from 'react'
import { CircleArrowUp, ExternalLink, RefreshCw, X } from 'lucide-react'
import { findApplication, useApplications } from '../apps/index.ts'
import type { ConnectionState } from '../events.ts'
import { BrandMark } from '../ui/BrandMark.tsx'
import { Popover } from '../ui/Popover.tsx'
import { AppIcon } from './AppIcon.tsx'
import type { BarPlacement } from './bar-placement.ts'
import { DockSplit } from './DockSplit.tsx'
import { fitLayout } from './layout.ts'
import type { LayoutId, SplitGroup } from './layout.ts'
import type { OpenWindow } from './state/types.ts'
import styles from './TaskBar.module.css'

const longPressDelay = 500
const longPressSlop = 10

const viewportMargin = 12

// 页面上的布局位置，不算 transform：Dock 展开收起的动画进行到一半时量出来的也是最终位置
function layoutOffset(element: HTMLElement, vertical: boolean) {
  let offset = 0
  for (let current: HTMLElement | null = element; current; current = current.offsetParent as HTMLElement | null) {
    offset += vertical ? current.offsetTop : current.offsetLeft
  }
  return offset
}

// 提示居中对着桌面按钮放不下时往里挪多少
function noticeShift(notice: HTMLElement, vertical: boolean) {
  const anchor = notice.parentElement!
  const center = layoutOffset(anchor, vertical) + (vertical ? anchor.offsetHeight : anchor.offsetWidth) / 2
  const length = vertical ? notice.offsetHeight : notice.offsetWidth
  const limit = vertical ? window.innerHeight : window.innerWidth
  const start = center - length / 2
  if (start < viewportMargin) return viewportMargin - start
  if (start + length > limit - viewportMargin) return limit - viewportMargin - start - length
  return 0
}

const connectionLabels: Record<ConnectionState, string> = {
  connected: '已连接',
  connecting: '连接中',
  failed: '连接失败',
  offline: '设备离线',
  updated: '有新版本',
}

// 屏幕外面的 Dock：回到桌面（下面的点是连接状态，需要刷新时旁边有提示）、开着的 app。
// 点 app 图标只是切换过去。长按能分屏的 app 图标后拖到屏幕的一侧分屏，没拖动就松手打开窗口菜单（取消分屏、在新标签页打开、关闭）；
// 分屏的一组和放不下分屏时长按直接打开菜单；鼠标右键也打开菜单
// 有 capsule 时 Dock 浮在屏幕底部之上，收起时只剩底部安全区里显示当前 app 或桌面的一颗胶囊
export function TaskBar({
  ref,
  screen,
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
  // 屏幕：分屏的两块按它的位置摆，按住正在显示的窗口时在它上面盖上桌面背景
  screen: () => HTMLElement | null
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
  onSplit: (id: string, at: number) => void
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
  const compact = capsule !== undefined
  // 底板在胶囊和 Dock 两种形状之间变，两头的宽度跟着内容量
  const surface = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const target = surface.current
    const from = capsuleButton.current
    const to = dock.current
    if (!target || !from || !to) return
    const update = () => {
      target.style.setProperty('--capsule-width', `${from.offsetWidth}px`)
      target.style.setProperty('--dock-width', `${to.offsetWidth}px`)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(from)
    observer.observe(to)
    return () => observer.disconnect()
  }, [compact])
  const notice = useRef<HTMLButtonElement>(null)
  useLayoutEffect(() => {
    const element = notice.current
    if (!element) return
    const update = () => element.style.setProperty('--shift', `${noticeShift(element, placement !== 'bottom')}px`)
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  })

  // 窗口菜单：同一时间只开一个。触屏上点到菜单外面时，旧菜单要等这次触摸的 click 才关，
  // 那时可能已经长按打开了另一个，所以只关自己
  const [menu, setMenu] = useState<string | null>(null)
  // 长按能分屏的 app 后拖着它排布
  type Drag = { key: string; held: OpenWindow; dock: DOMRect; screen: HTMLElement; start: { x: number; y: number }; pointer: { x: number; y: number }; moved: boolean }
  const [drag, setDrag] = useState<Drag | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  // 菜单开着或拖动中 Dock 不收起
  const busy = menu !== null || drag !== null
  const onMenu = capsule?.onMenu
  useEffect(() => {
    onMenu?.(busy)
  }, [onMenu, busy])
  // 往下滑收起 Dock 时一起关掉
  if (collapsed && (menu || drag)) {
    setMenu(null)
    setDrag(null)
  }
  const canSplit = (group: boolean) => !group && allowed.length > 1

  // 拖动中：图标跟着手指，手指下面是哪一块就亮哪一块。松手时在某一块上就分屏到那一侧；
  // 没拖动就松手是打开菜单；拖动了但不在任何一块上是取消
  useEffect(() => {
    if (!drag) return
    const zoneAt = (x: number, y: number) => {
      const at = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-split]')?.dataset.split
      return at === undefined ? null : Number(at)
    }
    const move = (event: globalThis.PointerEvent) => {
      const pointer = { x: event.clientX, y: event.clientY }
      setDrag((current) => current && { ...current, pointer, moved: current.moved || Math.hypot(pointer.x - current.start.x, pointer.y - current.start.y) > longPressSlop })
      setHover(zoneAt(pointer.x, pointer.y))
    }
    const up = (event: globalThis.PointerEvent) => {
      const at = zoneAt(event.clientX, event.clientY)
      setDrag(null)
      setHover(null)
      if (at !== null) onSplit(drag.held.id, at)
      else if (!drag.moved) setMenu(drag.key)
    }
    const cancel = () => {
      setDrag(null)
      setHover(null)
    }
    // 拖动时不让浏览器把这次触摸当成滚动
    const stopScroll = (event: TouchEvent) => event.preventDefault()
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancel()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('touchmove', stopScroll, { passive: false })
    window.addEventListener('keydown', escape)
    // 转屏或窗口变了，分屏的两块对不上了，取消
    window.addEventListener('resize', cancel)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('touchmove', stopScroll)
      window.removeEventListener('keydown', escape)
      window.removeEventListener('resize', cancel)
    }
  })

  const press = useRef<{ timer: number; x: number; y: number } | null>(null)
  // 长按后松手的那次 click 不再当成点击
  const longPressed = useRef(false)
  const cancelPress = () => {
    if (press.current) window.clearTimeout(press.current.timer)
    press.current = null
  }
  // 长按：能分屏就拖着排布，不能分屏（分屏的一组、屏幕放不下分屏）就直接打开菜单
  const startPress = (key: string, members: OpenWindow[], group: boolean) => (event: PointerEvent) => {
    longPressed.current = false
    cancelPress()
    if (event.button !== 0) return
    const start = { x: event.clientX, y: event.clientY }
    press.current = {
      ...start,
      timer: window.setTimeout(() => {
        press.current = null
        longPressed.current = true
        const screenElement = screen()
        if (canSplit(group) && dock.current && screenElement) {
          setMenu(null)
          setDrag({ key, held: members[0], dock: dock.current.getBoundingClientRect(), screen: screenElement, start, pointer: start, moved: false })
        } else {
          setMenu(key)
        }
      }, longPressDelay),
    }
  }
  const movePress = (event: PointerEvent) => {
    const start = press.current
    if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > longPressSlop) cancelPress()
  }
  const sides = { bottom: 'top', left: 'right', right: 'left' } as const
  const openExternal = (member: OpenWindow) => {
    // 外部 app 的窗口可以在新标签页打开，比如要在那里重新登录
    const url = findApplication(apps, member.window.applicationId)?.url
    if (url) window.open(url, '_blank', 'noopener,noreferrer')
  }
  useEffect(() => {
    const target = moveFocus.current === 'dock'
      ? dock.current?.querySelector<HTMLElement>('[aria-pressed="true"]') ?? dock.current?.querySelector<HTMLElement>('button')
      : moveFocus.current === 'capsule' ? capsuleButton.current : null
    moveFocus.current = null
    target?.focus()
  }, [collapsed])
  // 分屏时另一侧直接放的窗口：正在显示的另一个不在分屏里的窗口，和 useShellController 的 split 一致
  const partner = (id: string) => {
    if (home || !focused || focused === id || groups.some((group) => group.slots.includes(focused))) return undefined
    return windows.find((item) => item.id === focused)
  }
  const appName = (member: OpenWindow) => findApplication(apps, member.window.applicationId)?.name ?? member.title
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
      {capsule && <div ref={surface} className={styles.surface} aria-hidden />}
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
            <button ref={notice} type="button" className={styles.notice} data-connection={connection} onClick={() => window.location.reload()}>
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
        {windows.length > 0 && (
          <div className={styles.apps}>
            {windows.filter((item) => {
              const group = groups.find((group) => group.slots.includes(item.id))
              return !group || group.slots[0] === item.id
            }).map((item) => {
              const group = groups.find((group) => group.slots.includes(item.id))
              const members = group ? group.slots.map((id) => windows.find((win) => win.id === id)!).filter(Boolean) : [item]
              const title = members.map((member) => member.title).join(' + ')
              const key = group?.id ?? item.id
              // 点一组时显示组里聚焦的那个，没有聚焦的就是第一个
              const target = members.find((member) => member.id === focused) ?? item
              const pressed = !home && members.some((member) => member.id === focused)
              return (
                <Popover
                  key={key}
                  label={`${title} 的窗口操作`}
                  className={styles.menu}
                  side={sides[placement]}
                  align="center"
                  open={menu === key}
                  onOpenChange={(open) => {
                    if (open) setMenu(key)
                    else if (menu === key) setMenu(null)
                  }}
                  trigger={
                    <button
                      type="button"
                      className={styles.item}
                      data-group={!!group}
                      data-held={drag?.key === key}
                      aria-label={title}
                      title={title}
                      aria-pressed={pressed}
                      data-visible={!home && members.some((member) => panes.includes(member.id))}
                      onPointerDown={startPress(key, members, !!group)}
                      onPointerMove={movePress}
                      onPointerUp={cancelPress}
                      onPointerCancel={cancelPress}
                      onContextMenu={(event) => {
                        event.preventDefault()
                        cancelPress()
                        if (!longPressed.current) setMenu(key)
                      }}
                      onClick={(event) => {
                        // 菜单只由长按和右键打开，不交给 Popover 的触发按钮
                        event.preventDefault()
                        if (longPressed.current) {
                          longPressed.current = false
                          return
                        }
                        if (pressed) return
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
                  {group && (
                    <button type="button" className={styles.menuItem} onClick={() => { setMenu(null); onUnsplit(item.id) }}>
                      <span className={styles.menuIcon}><span className={styles.single} /></span>
                      取消分屏
                    </button>
                  )}
                  {members.filter((member) => findApplication(apps, member.window.applicationId)?.url).map((member) => (
                    <button key={`external:${member.id}`} type="button" className={styles.menuItem} onClick={() => { setMenu(null); openExternal(member) }}>
                      <span className={styles.menuIcon}><ExternalLink size={18} strokeWidth={1.75} /></span>
                      {group ? `在新标签页打开 ${appName(member)}` : '在新标签页打开'}
                    </button>
                  ))}
                  {members.map((member) => (
                    <button key={`close:${member.id}`} type="button" className={styles.menuItem} onClick={() => { setMenu(null); onClose(member.id) }}>
                      <span className={styles.menuIcon} data-type="close"><X size={18} strokeWidth={1.75} /></span>
                      {group ? `关闭 ${appName(member)}` : '关闭'}
                    </button>
                  ))}
                </Popover>
              )
            })}
          </div>
        )}
      </div>
      {drag && (
        <DockSplit
          held={drag.held}
          placement={placement}
          dock={drag.dock}
          screen={drag.screen}
          split={{ layout: fitLayout('1:1', allowed), portrait }}
          partner={partner(drag.held.id)}
          pointer={drag.pointer}
          hover={hover}
        />
      )}
    </nav>
  )
}
