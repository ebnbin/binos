import { findApplication } from '../apps/definitions.ts'
import type { ApplicationDefinition, WidgetSize } from '../apps/types.ts'

export type Shortcut = { id: string; kind: 'shortcut'; applicationId: string }
export type WidgetInstance = { id: string; kind: 'widget'; applicationId: string; widgetId: string; size: WidgetSize }

// 顺序固定，屏幕只决定分成几栏、每栏放到哪一个。
export type DesktopItem = Shortcut | WidgetInstance

const shortcut = (applicationId: string, id = `shortcut:${applicationId}`): Shortcut => ({ id, kind: 'shortcut', applicationId })
const widget = (id: string, applicationId: string, widgetId: string, size: WidgetSize): WidgetInstance => ({ id, kind: 'widget', applicationId, widgetId, size })

// 外部 app 的图标排在系统 app 后面
const defaultDesktop = (apps: ApplicationDefinition[]): DesktopItem[] => [
  widget('system-status', 'system', 'status', '4x2'),
  shortcut('code'),
  shortcut('kita'),
  shortcut('browser'),
  shortcut('system'),
  shortcut('terminal'),
  ...apps.filter((app) => app.url).map((app) => shortcut(app.id, `external:${app.id}`)),
  shortcut('music'),
  shortcut('files'),
  widget('code-recent', 'code', 'recent', '4x2'),
  widget('calendar-main', 'calendar', 'main', '4x4'),
  widget('music-main', 'music', 'main', '2x2'),
  widget('kita-status', 'kita', 'status', '2x2'),
]

// 去掉还没有的 app、widget 和不支持的尺寸
export function desktopItems(apps: ApplicationDefinition[]): DesktopItem[] {
  return defaultDesktop(apps).filter((item) => {
    const app = findApplication(apps, item.applicationId)
    if (!app || item.kind === 'shortcut') {
      return Boolean(app?.mainWindow)
    }
    return app.widgets?.[item.widgetId]?.sizes.includes(item.size) ?? false
  })
}

// 占几格，宽 × 高
export function itemSize(item: DesktopItem) {
  if (item.kind === 'shortcut') {
    return { width: 1, height: 1 }
  }
  const [width, height] = item.size.split('x').map(Number)
  return { width, height }
}
