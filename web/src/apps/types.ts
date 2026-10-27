import type { Icon } from '@phosphor-icons/react'
import type { ComponentType } from 'react'

export type ApplicationDefinition = {
  id: string
  name: string
  icon: Icon
  // 独立部署的 web app 的网址，来自 app 注册表
  url?: string
  views: Record<string, ViewDefinition>
  mainWindow?: { viewId: string }
  widgets?: Record<string, WidgetDefinition>
  // 「系统」app 里这个 app 的设置页，路由是 /apps/<app 的 id>
  settings?: SettingsDefinition
}

export type ViewDefinition =
  | { kind: 'window'; component: ComponentType<{ ctx: WindowContext }> }
  | { kind: 'widget'; component: ComponentType<WidgetContext> }

// route 由 app 自己解释，窗口内容不依赖 Shell 的布局和存储。
export type WindowContext = {
  windowId: string
  route: string
  navigate(route: string, options?: { replace?: boolean }): void
  // 回到这个窗口的上一页，没有上一页时回到 app 的首页
  openApplication?(id: string, route?: string): void
  back(): void
  setTitle(title: string): void
}

// 桌面上的格子数，宽 × 高。一栏宽 4 格
export type WidgetSize = '2x2' | '4x2' | '4x4'

export type WidgetDefinition = {
  name: string
  viewId: string
  sizes: WidgetSize[]
}

export type WidgetContext = {
  instanceId: string
  size: WidgetSize
  open(route?: string): void
}

export type SettingsDefinition = {
  hint: string
  component: ComponentType<{ back(): void }>
}
