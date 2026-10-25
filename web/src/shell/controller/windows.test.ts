import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const values = new Map<string, string>()
let browser: EventTarget & { history: { replaceState: ReturnType<typeof vi.fn<History['replaceState']>>; pushState: ReturnType<typeof vi.fn<History['pushState']>> } }

beforeEach(() => {
  vi.resetModules()
  values.clear()
  browser = Object.assign(new EventTarget(), { history: { replaceState: vi.fn<History['replaceState']>(), pushState: vi.fn<History['pushState']>() } })
  vi.stubGlobal('window', browser)
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  })
})

afterEach(() => vi.unstubAllGlobals())

const saved = () => JSON.parse(values.get('binos.windows')!)
const seed = (value: unknown) => values.set('binos.windows', JSON.stringify(value))

function storageChanged() {
  browser.dispatchEvent(Object.assign(new Event('storage'), { key: 'binos.windows' }))
}

describe('window state and controller compatibility', () => {
  it('restores legacy workspace and preserves window IDs, routes and the storage format', async () => {
    const windows = { a: { app: 'code', route: '/session' }, b: { app: 'system', route: '/agent' } }
    seed({ windows, workspace: { layout: '1:1', slots: ['a', 'b'] } })
    const state = await import('../state/windows.ts')
    expect(state.getWindows()).toEqual({
      windows: {
        a: { id: 'a', applicationId: 'code', viewId: 'main', route: '/session' },
        b: { id: 'b', applicationId: 'system', viewId: 'main', route: '/agent' },
      },
      groups: [{ id: 'legacy', layout: '1:1', slots: ['a', 'b'] }],
    })
    state.setRoute('a', '/next')
    expect(saved()).toEqual({
      windows: { ...windows, a: { app: 'code', route: '/next' } },
      groups: [{ id: 'legacy', layout: '1:1', slots: ['a', 'b'] }],
    })
  })

  it('keeps app entry reuse in the controller, including restored and unknown apps', async () => {
    seed({ windows: { existing: { app: 'code', route: '/session' } }, groups: [] })
    const { ensureApplicationWindow } = await import('./applications.ts')
    const { getWindows } = await import('../state/windows.ts')
    expect(ensureApplicationWindow([], 'code')).toBe('existing')
    expect(getWindows().windows.existing.route).toBe('/session')
    const id = ensureApplicationWindow([], 'unavailable')!
    expect(ensureApplicationWindow([], 'unavailable')).toBe(id)
    expect(saved().windows[id]).toEqual({ app: 'unavailable', route: '/' })
    expect(Object.keys(getWindows().windows)).toHaveLength(2)
  })

  it('does not create or reuse windows for widget-only applications', async () => {
    const { builtinApplications } = await import('../../apps/builtins.ts')
    const { validateApplications } = await import('../../apps/definitions.ts')
    const { desktopItems } = await import('../desktop-items.ts')
    const { ensureApplicationWindow } = await import('./applications.ts')
    const { getWindows } = await import('../state/windows.ts')
    const calendar = { ...builtinApplications.find((app) => app.id === 'calendar')!, name: '日历' }
    expect(validateApplications([calendar])).toEqual([calendar])
    expect(ensureApplicationWindow([calendar], 'calendar')).toBeUndefined()
    expect(getWindows().windows).toEqual({})
    expect(desktopItems([calendar])).toEqual([
      { id: 'calendar-main', kind: 'widget', applicationId: 'calendar', widgetId: 'main', size: '4x4' },
    ])
    expect(() => validateApplications([{ ...calendar, mainWindow: { viewId: 'month' } }])).toThrow('Invalid main window view')
    seed({ windows: { old: { app: 'calendar', route: '/' } }, groups: [] })
    storageChanged()
    expect(ensureApplicationWindow([calendar], 'calendar')).toBeUndefined()
  })

  it('synchronizes split groups from another tab and dissolves the group when a member closes', async () => {
    const state = await import('../state/windows.ts')
    seed({
      windows: { a: { app: 'code', route: '/session' }, b: { app: 'system', route: '/' } },
      groups: [{ id: 'pair', layout: '2:1', slots: ['a', 'b'] }],
    })
    storageChanged()
    expect(state.getWindows().groups).toEqual([{ id: 'pair', layout: '2:1', slots: ['a', 'b'] }])
    state.closeWindow('a')
    expect(saved()).toEqual({ windows: { b: { app: 'system', route: '/' } }, groups: [] })
  })

  it('keeps browser navigation, per-window back stacks and titles scoped to their instance', async () => {
    seed({ windows: { a: { app: 'code', route: '/' }, b: { app: 'system', route: '/' } }, groups: [] })
    const { createWindowContext } = await import('./navigation.ts')
    const { getWindows } = await import('../state/windows.ts')
    const { restoreRoute } = await import('./history.ts')
    const title = vi.fn<(id: string, title: string) => void>()
    createWindowContext('a', '/', title).navigate('/one')
    createWindowContext('b', '/', title).navigate('/agent')
    createWindowContext('a', '/one', title).navigate('/two')
    expect(browser.history.pushState.mock.calls).toEqual([
      [{ window: 'a', route: '/one' }, '', '/'],
      [{ window: 'b', route: '/agent' }, '', '/'],
      [{ window: 'a', route: '/two' }, '', '/'],
    ])
    const context = createWindowContext('a', '/two', title)
    expect(context.windowId).toBe('a')
    context.setTitle('Session')
    expect(title).toHaveBeenCalledWith('a', 'Session')
    context.back()
    expect(getWindows().windows.a.route).toBe('/one')
    createWindowContext('b', '/agent', title).back()
    expect(getWindows().windows.b.route).toBe('/')
    const pushes = browser.history.pushState.mock.calls.length
    createWindowContext('a', '/one', title).navigate('/one')
    createWindowContext('a', '/one', title).navigate('/replaced', { replace: true })
    expect(browser.history.pushState).toHaveBeenCalledTimes(pushes)
    restoreRoute('a', '/')
    createWindowContext('a', '/', title).back()
    expect(getWindows().windows.a.route).toBe('/')
  })
})
