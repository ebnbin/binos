import { useEffect, useId, useRef, useState } from 'react'
import type { PointerEvent, PointerEventHandler, ReactNode, Ref } from 'react'
import { CircleArrowUp, RefreshCw } from 'lucide-react'
import { findApplication, useApplications } from '../apps/index.ts'
import type { ConnectionState } from '../events.ts'
import { BrandMark } from '../ui/BrandMark.tsx'
import { AppIcon } from './AppIcon.tsx'
import type { BarPlacement } from './bar-placement.ts'
import { DockActions } from './DockActions.tsx'
import { parseDrop } from './drop-target.ts'
import type { DropTarget } from './drop-target.ts'
import { fitLayout } from './layout.ts'
import type { LayoutId, SplitGroup } from './layout.ts'
import type { OpenWindow } from './state/types.ts'
import styles from './TaskBar.module.css'

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
// 窗口的操作（分屏、取消分屏、在新标签页打开、关闭）：长按 app 图标后拖到要做的操作上，或者长按后松手、右键、再点一次正在显示的图标，再点要做的操作
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
  // 屏幕在页面上的位置，分屏的两块按它摆
  screen: () => DOMRect | undefined
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

  // 长按 app 图标出现的操作。拖动时 pointer 是手指的位置；长按后直接松手、右键或再点一次时是 null，点要做的操作
  type Active = { members: OpenWindow[]; group: boolean; origin: DOMRect; dock: DOMRect; screen: DOMRect; pointer: { x: number; y: number } | null; moved: boolean }
  const [active, setActive] = useState<Active | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const open = (members: OpenWindow[], group: boolean, element: Element, pointer: { x: number; y: number } | null) => {
    const screenRect = screen()
    if (!dock.current || !screenRect) return
    setActive({ members, group, origin: element.getBoundingClientRect(), dock: dock.current.getBoundingClientRect(), screen: screenRect, pointer, moved: false })
    setHover(null)
    capsule?.onMenu(true)
  }
  const finish = (target: DropTarget | null) => {
    const current = active
    setActive(null)
    setHover(null)
    capsule?.onMenu(false)
    if (!current || !target) return
    const [first] = current.members
    if (target.type === 'unsplit') onUnsplit(first.id)
    if (target.type === 'split') onSplit(first.id, target.at)
    if (target.type === 'close') onClose(target.id)
    if (target.type === 'external') {
      // 外部 app 的窗口可以在新标签页打开，比如要在那里重新登录
      const url = findApplication(apps, windows.find((item) => item.id === target.id)?.window.applicationId ?? '')?.url
      if (url) window.open(url, '_blank', 'noopener,noreferrer')
    }
  }
  // 往下滑收起 Dock 时一起关掉
  if (collapsed && active) {
    setActive(null)
  }

  // 松手后要做的操作，等这一轮事件结束再做；null 是没拖动，留着等点
  const drop = useRef<string | null>(null)
  // 拖动中：图标跟着手指，手指下面是哪个放置位置就亮哪个；松手时动过就做那个操作，没动过就留着等点
  const dragging = active?.pointer != null
  useEffect(() => {
    if (!dragging) return
    const targetAt = (x: number, y: number) => document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-drop]')?.dataset.drop ?? null
    const move = (event: globalThis.PointerEvent) => {
      setActive((current) => current && current.pointer && {
        ...current,
        pointer: { x: event.clientX, y: event.clientY },
        moved: current.moved || Math.hypot(event.clientX - current.pointer.x, event.clientY - current.pointer.y) > longPressSlop,
      })
      setHover(targetAt(event.clientX, event.clientY))
    }
    const up = (event: globalThis.PointerEvent) => {
      const key = targetAt(event.clientX, event.clientY)
      setActive((current) => current && { ...current, pointer: null })
      if (active?.moved || key) drop.current = key ?? 'cancel'
      else drop.current = null
    }
    const cancel = () => {
      drop.current = 'cancel'
      setActive((current) => current && { ...current, pointer: null })
    }
    // 拖动时不让浏览器把这次触摸当成滚动
    const stopScroll = (event: TouchEvent) => event.preventDefault()
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('touchmove', stopScroll, { passive: false })
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('touchmove', stopScroll)
    }
  })
  useEffect(() => {
    if (!active || active.pointer || drop.current === null) return
    const key = drop.current
    drop.current = null
    finish(parseDrop(key))
  })
  useEffect(() => {
    if (!active) return
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') finish(null)
    }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  })

  const press = useRef<{ timer: number; x: number; y: number } | null>(null)
  // 长按后松手的那次 click 不再当成点击
  const longPressed = useRef(false)
  const cancelPress = () => {
    if (press.current) window.clearTimeout(press.current.timer)
    press.current = null
  }
  const startPress = (members: OpenWindow[], group: boolean) => (event: PointerEvent) => {
    longPressed.current = false
    cancelPress()
    if (event.button !== 0) return
    const element = event.currentTarget
    const pointer = { x: event.clientX, y: event.clientY }
    press.current = {
      ...pointer,
      timer: window.setTimeout(() => {
        press.current = null
        longPressed.current = true
        open(members, group, element, pointer)
      }, longPressDelay),
    }
  }
  const movePress = (event: PointerEvent) => {
    const start = press.current
    if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > longPressSlop) cancelPress()
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
            // 点一组时显示组里聚焦的那个，没有聚焦的就是第一个
            const target = members.find((member) => member.id === focused) ?? item
            const pressed = !home && members.some((member) => member.id === focused)
            return (
              <button
                key={key}
                type="button"
                className={styles.item}
                data-group={!!group}
                data-held={active?.members[0].id === members[0].id}
                aria-label={title}
                title={title}
                aria-pressed={pressed}
                aria-haspopup="menu"
                data-visible={!home && members.some((member) => panes.includes(member.id))}
                onPointerDown={startPress(members, !!group)}
                onPointerMove={movePress}
                onPointerUp={cancelPress}
                onPointerCancel={cancelPress}
                onContextMenu={(event) => {
                  event.preventDefault()
                  cancelPress()
                  if (!longPressed.current) open(members, !!group, event.currentTarget, null)
                }}
                onClick={(event) => {
                  if (longPressed.current) {
                    longPressed.current = false
                    return
                  }
                  if (pressed) {
                    open(members, !!group, event.currentTarget, null)
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
            )
          })}
        </div>
      </div>
      {active && (
        <DockActions
          members={active.members}
          group={active.group}
          placement={placement}
          origin={active.origin}
          dock={active.dock}
          screen={active.screen}
          split={!active.group && allowed.length > 1 ? { layout: fitLayout('1:1', allowed), portrait } : undefined}
          partner={partner(active.members[0].id)}
          pointer={active.pointer}
          hover={hover}
          onChoose={finish}
        />
      )}
    </nav>
  )
}
