import { CalendarDays, Cat, CodeXml, Folder, Gauge, Globe, Music, Terminal } from 'lucide-react'
import { lazy } from 'react'
import type { ApplicationDefinition } from './types.ts'

export const builtinApplications: ApplicationDefinition[] = [
  {
    id: 'calendar',
    name: '日历',
    icon: CalendarDays,
    views: {
      month: { kind: 'widget', component: lazy(() => import('./calendar/CalendarWidget.tsx').then((module) => ({ default: module.CalendarWidget }))) },
    },
    widgets: { main: { name: '月历', viewId: 'month', sizes: ['4x4'] } },
  },
  {
    id: 'music',
    name: '音乐',
    icon: Music,
    mainWindow: { viewId: 'main' },
    views: {
      main: { kind: 'window', component: lazy(() => import('./music/MusicApp.tsx').then((module) => ({ default: module.MusicApp }))) },
      widget: { kind: 'widget', component: lazy(() => import('./music/MusicWidget.tsx').then((module) => ({ default: module.MusicWidget }))) },
    },
    widgets: { main: { name: '正在播放', viewId: 'widget', sizes: ['2x2', '4x2', '4x4'] } },
  },
  {
    id: 'browser',
    name: '浏览器',
    icon: Globe,
    mainWindow: { viewId: 'main' },
    views: {
      main: {
        kind: 'window',
        component: lazy(() => import('./browser/BrowserApp.tsx').then((module) => ({ default: module.BrowserApp }))),
      },
    },
  },
  {
    id: 'terminal',
    name: '终端',
    icon: Terminal,
    mainWindow: { viewId: 'main' },
    views: {
      main: {
        kind: 'window',
        component: lazy(() => import('./terminal/TerminalApp.tsx').then((module) => ({ default: module.TerminalApp }))),
      },
    },
  },
  {
    id: 'files',
    name: '文件',
    icon: Folder,
    mainWindow: { viewId: 'main' },
    views: {
      main: {
        kind: 'window',
        component: lazy(() => import('./files/FilesApp.tsx').then((module) => ({ default: module.FilesApp }))),
      },
    },
  },
  {
    id: 'code',
    name: 'Code',
    icon: CodeXml,
    mainWindow: { viewId: 'main' },
    views: {
      main: {
        kind: 'window',
        component: lazy(() => import('./code/CodeApp.tsx').then((module) => ({ default: module.CodeApp }))),
      },
      recent: {
        kind: 'widget',
        component: lazy(() => import('./code/CodeWidget.tsx').then((module) => ({ default: module.CodeWidget }))),
      },
    },
    widgets: { recent: { name: '最近的对话', viewId: 'recent', sizes: ['2x2', '4x2', '4x4'] } },
  },
  {
    id: 'kita',
    name: '喜多',
    icon: Cat,
    mainWindow: { viewId: 'main' },
    views: {
      main: { kind: 'window', component: lazy(() => import('./kita/KitaApp.tsx').then((module) => ({ default: module.KitaApp }))) },
      status: { kind: 'widget', component: lazy(() => import('./kita/KitaWidget.tsx').then((module) => ({ default: module.KitaWidget }))) },
    },
    widgets: { status: { name: '喜多', viewId: 'status', sizes: ['2x2', '4x2', '4x4'] } },
  },
  {
    id: 'system',
    name: '系统',
    icon: Gauge,
    mainWindow: { viewId: 'main' },
    views: {
      main: {
        kind: 'window',
        component: lazy(() => import('./system/SystemApp.tsx').then((module) => ({ default: module.SystemApp }))),
      },
      status: {
        kind: 'widget',
        component: lazy(() => import('./system/SystemWidget.tsx').then((module) => ({ default: module.SystemWidget }))),
      },
    },
    widgets: { status: { name: '时间和状态', viewId: 'status', sizes: ['2x2', '4x2'] } },
  },
]
