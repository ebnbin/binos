import { useEffect, useId, useRef } from 'react'
import type { PointerEventHandler, ReactNode, Ref } from 'react'
import { ExternalLink, X } from 'lucide-react'
import { findApplication, useApplications } from '../apps/index.ts'
import { BrandMark } from '../ui/BrandMark.tsx'
import { AppIcon } from './AppIcon.tsx'
import type { BarPlacement } from './bar-placement.ts'
import { layouts } from './layout.ts'
import type { LayoutId, SplitGroup } from './layout.ts'
import type { OpenWindow } from './state/types.ts'
import styles from './TaskBar.module.css'

// active：聚焦的位置，亮起来的那一块
function LayoutGlyph({ layout, portrait, active }: { layout: LayoutId; portrait: boolean; active?: number }) {
  return (
    <span className={styles.glyph} data-portrait={portrait}>
      {layouts[layout].map((part, index) => (
        <i key={index} style={{ flex: part }} data-active={active === undefined ? undefined : index === active} />
      ))}
    </span>
  )
}

// 屏幕外面的 Dock：回到桌面、开着的 app、分屏布局、在新标签页打开外部 app、关闭当前窗口。分屏时，布局按钮上亮起的一块是聚焦的窗口。
// 有 capsule 时 Dock 浮在屏幕底部之上，收起时只剩底部安全区里显示当前 app 或桌面的一颗胶囊
export function TaskBar({
  ref,
  capsule,
  placement,
  accessory,
  windows,
  groups,
  locked,
  panes,
  focused,
  focusedSlot,
  home,
  layout,
  allowed,
  portrait,
  onHome,
  onShow,
  onSplit,
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
  }
  placement: Exclude<BarPlacement, 'hidden'>
  accessory?: ReactNode
  windows: OpenWindow[]
  groups: SplitGroup[]
  locked: boolean
  panes: (string | null)[]
  focused: string | null
  focusedSlot: number
  home: boolean
  layout: LayoutId
  allowed: LayoutId[]
  portrait: boolean
  onHome: () => void
  onShow: (id: string) => void
  onSplit: () => void
  onClose: () => void
}) {
  const apps = useApplications()
  // 外部 app 的窗口可以在新标签页打开，比如要在那里重新登录
  const focusedUrl = findApplication(apps, windows.find((item) => item.id === focused)?.window.applicationId ?? '')?.url
  const canPick = !home && !locked && !groups.some((group) => focused && group.slots.includes(focused)) && allowed.length > 1
  // 胶囊在桌面上只有 binOS 的标志，在 app 里是 app 的图标和名字，不带窗口标题里的状态
  const capsuleApp = !home && capsule?.current ? findApplication(apps, capsule.current.window.applicationId) : undefined
  const capsuleName = capsuleApp?.name ?? '桌面'
  const dockId = useId()
  const dock = useRef<HTMLDivElement>(null)
  const capsuleButton = useRef<HTMLButtonElement>(null)
  // 用键盘展开或收起时，焦点跟着移到显示出来的那一边，不留在被隐藏的按钮上
  const moveFocus = useRef<'dock' | 'capsule' | null>(null)
  const collapsed = capsule?.collapsed
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
          aria-label={`${capsuleName}，展开 Dock`}
          aria-expanded={false}
          aria-controls={dockId}
          onClick={(event) => {
            if (event.currentTarget.matches(':focus-visible')) moveFocus.current = 'dock'
            capsule.onExpand()
          }}
        >
          {capsuleApp ? <AppIcon app={capsuleApp} className={styles.capsuleIcon} /> : <BrandMark size={20} inverted />}
          {capsuleApp && <span className={styles.capsuleTitle}>{capsuleName}</span>}
        </button>
      )}
      <div ref={dock} id={dockId} className={styles.dock} inert={collapsed}>
        <button type="button" className={styles.item} aria-label="桌面" title="桌面" aria-pressed={home} onClick={onHome}>
          <BrandMark size={30} inverted />
        </button>
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
            return (
              <button
                key={group?.id ?? item.id}
                type="button"
                className={styles.item}
                data-group={!!group}
                aria-label={title}
                title={title}
                aria-pressed={!home && members.some((member) => member.id === focused)}
                data-visible={!home && members.some((member) => panes.includes(member.id))}
                onClick={() => {
                  if (capsule && focusVisibleInside(dock.current)) moveFocus.current = 'capsule'
                  onShow(members.find((member) => member.id === focused)?.id ?? item.id)
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
        {!home && focused && (
          <>
            <span className={styles.separator} />
            {canPick && (
              <button type="button" className={styles.item} aria-label="分屏" title="分屏" onClick={onSplit}>
                <LayoutGlyph layout={layout === '1' ? '1:1' : layout} portrait={portrait} active={layout === '1' ? undefined : focusedSlot} />
              </button>
            )}
            {focusedUrl && (
              <button
                type="button"
                className={styles.item}
                aria-label="在新标签页打开"
                title="在新标签页打开"
                onClick={() => window.open(focusedUrl, '_blank', 'noopener,noreferrer')}
              >
                <ExternalLink size={20} strokeWidth={1.75} />
              </button>
            )}
            <button type="button" className={styles.item} aria-label="关闭当前窗口" title="关闭当前窗口" onClick={onClose}>
              <X size={20} strokeWidth={1.75} />
            </button>
          </>
        )}
      </div>
    </nav>
  )
}
