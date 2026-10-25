import { useCallback, useEffect, useState } from 'react'
import { findApplication, useApplications } from '../../apps/index.ts'
import type { ApplicationDefinition } from '../../apps/types.ts'
import { allowedLayouts, arrange, fitLayout, isPortrait } from '../layout.ts'
import type { LayoutId, Size, Workspace as WorkspaceState } from '../layout.ts'
import { closeWindow, createGroup, dissolveGroup, setRoute, updateGroup, useWindows } from '../state/windows.ts'
import type { OpenWindow } from '../state/types.ts'
import { useShellViewState } from '../state/view.ts'
import { ensureApplicationWindow } from './applications.ts'
import { restoreRoute } from './history.ts'
import type { HistoryState } from './history.ts'

const appOrder = (apps: ApplicationDefinition[], appId: string) => apps.findIndex((app) => app.id === appId)

export function useShellController(size: Size | null) {
  const apps = useApplications()
  const stored = useWindows()
  const [titles, setTitles] = useState<Record<string, string>>({})
  const onTitle = useCallback((id: string, title: string) => setTitles((prev) => (prev[id] === title ? prev : { ...prev, [id]: title })), [])
  const [view, setView] = useShellViewState()
  const [draft, setDraft] = useState<WorkspaceState | null>(null)

  const windows: OpenWindow[] = Object.entries(stored.windows)
    .map(([id, win]) => {
      const appName = findApplication(apps, win.applicationId)?.name ?? win.applicationId
      return { id, window: win, title: titles[id] ? `${appName} · ${titles[id]}` : appName }
    })
    .sort((a, b) => appOrder(apps, a.window.applicationId) - appOrder(apps, b.window.applicationId))
  const ids = windows.map((item) => item.id)

  const allowed: LayoutId[] = size ? allowedLayouts(size) : ['1']
  const portrait = size ? isPortrait(size) : false
  const recent = view.recent.filter((id) => ids.includes(id))
  const focusedWindow = view.focused && ids.includes(view.focused) ? view.focused : (recent[0] ?? null)
  const group = stored.groups.find((item) => focusedWindow && item.slots.includes(focusedWindow))
  const workspace: WorkspaceState = draft ?? group ?? { layout: '1', slots: [focusedWindow, null] }
  const layout = fitLayout(workspace.layout, allowed, workspace.slots.indexOf(focusedWindow))
  const panes = arrange(workspace, layout, focusedWindow)
  const slot = Math.max(0, panes.indexOf(focusedWindow))
  const focused = panes[slot]
  const home = !draft && (view.home || panes.every((id) => id === null))

  const focus = (id: string | null, at: number) =>
    setView((prev) =>
      !prev.home && prev.slot === at && (id === null || prev.focused === id)
        ? prev
        : { home: false, focused: id ?? prev.focused, slot: at, recent: id ? [id, ...prev.recent.filter((item) => item !== id)].slice(0, 20) : prev.recent },
    )

  const show = (id: string) => {
    if (draft) return
    const target = stored.groups.find((item) => item.slots.includes(id))
    focus(id, target?.slots.indexOf(id) ?? 0)
  }

  const open = (appId: string, route?: string) => {
    if (draft) return
    const id = ensureApplicationWindow(apps, appId)
    if (!id) return
    if (route) setRoute(id, route)
    show(id)
  }

  const chooseLayout = (next: LayoutId) => {
    if (!draft && group && next !== group.layout) updateGroup(group.id, { ...group, layout: next })
  }

  const exitSplit = (keep: number) => {
    if (draft) { setDraft(null); return }
    const id = panes[keep]
    if (group) dissolveGroup(group.id)
    if (id) focus(id, 0)
  }

  const close = () => {
    if (draft || !focused) return
    const next = group ? group.slots.find((id) => id !== focused) ?? null : recent.find((id) => id !== focused) ?? null
    closeWindow(focused)
    setView((prev) => ({ ...prev, home: !next, focused: next, slot: 0 }))
  }

  // 关掉任意一个窗口；它在分屏组里时整组一起关
  const remove = (id: string) => {
    if (draft) return
    const members: string[] = stored.groups.find((item) => item.slots.includes(id))?.slots ?? [id]
    members.forEach((member) => closeWindow(member))
    if (!focused || !members.includes(focused)) return
    const next = recent.find((item) => !members.includes(item)) ?? ids.find((item) => !members.includes(item)) ?? null
    const at = next ? stored.groups.find((item) => item.slots.includes(next))?.slots.indexOf(next) ?? 0 : 0
    setView((prev) => ({ ...prev, home: prev.home || !next, focused: next, slot: at }))
  }

  if (draft && (!allowed.includes(draft.layout) || !stored.windows[draft.slots[0]!])) setDraft(null)

  // 浏览器返回时，恢复那条记录的窗口和路由
  useEffect(() => {
    const onPopState = () => {
      if (draft) return
      const state = window.history.state as HistoryState
      if (state && ids.includes(state.window)) {
        restoreRoute(state.window, state.route)
        setRoute(state.window, state.route)
        show(state.window)
      }
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  })

  const pick = (appId: string) => {
    if (!draft || !draft.slots[0]) return
    const existing = windows.find((item) => item.window.applicationId === appId)
    if (existing && stored.groups.some((item) => item.slots.includes(existing.id))) return
    const id = ensureApplicationWindow(apps, appId)
    if (!id) return
    createGroup({ layout: draft.layout, slots: [draft.slots[0], id] })
    setDraft(null)
    focus(id, 1)
  }

  const swap = () => {
    if (draft || !group) return
    updateGroup(group.id, { ...group, slots: [...group.slots].reverse() })
    if (focused) focus(focused, 1 - slot)
  }

  const toggleHome = () => { if (!draft) setView((prev) => ({ ...prev, home: !home })) }
  const split = () => {
    if (draft || !focused || group) return
    setDraft({ layout: fitLayout('1:1', allowed), slots: [focused, null] })
  }

  return {
    windows, groups: stored.groups, panes,
    // 最近用过的在前，没聚焦过的按窗口顺序排在后面
    order: [...recent, ...ids.filter((id) => !recent.includes(id))], layout, home, portrait, focused, slot, allowed,
    picking: draft !== null,
    unavailableApps: windows.filter((item) => stored.groups.some((group) => group.slots.includes(item.id))).map((item) => item.window.applicationId),
    focus, chooseLayout, exitSplit, pick, swap, cancel: () => exitSplit(slot), onTitle,
    open, show, close, remove, toggleHome, split,
  }
}
