import { CalendarDotsIcon, CatIcon, CodeIcon, FolderIcon, GaugeIcon, GlobeIcon, MusicNotesIcon, TerminalIcon } from '@phosphor-icons/react'
import { lazy } from 'react'
import type { ApplicationDefinition } from './types.ts'

// 名称由后端给出（GET /api/apps 的 builtin）
export const builtinApplications: Omit<ApplicationDefinition, 'name'>[] = [
  {
    id: 'calendar',
    icon: CalendarDotsIcon,
    views: {
      month: { kind: 'widget', component: lazy(() => import('./calendar/CalendarWidget.tsx').then((module) => ({ default: module.CalendarWidget }))) },
    },
    widgets: { main: { name: '月历', viewId: 'month', sizes: ['4x4'] } },
  },
  {
    id: 'music',
    icon: MusicNotesIcon,
    mainWindow: { viewId: 'main' },
    views: {
      main: { kind: 'window', component: lazy(() => import('./music/MusicApp.tsx').then((module) => ({ default: module.MusicApp }))) },
      widget: { kind: 'widget', component: lazy(() => import('./music/MusicWidget.tsx').then((module) => ({ default: module.MusicWidget }))) },
    },
    widgets: { main: { name: '正在播放', viewId: 'widget', sizes: ['2x2', '4x2', '4x4'] } },
  },
  {
    id: 'browser',
    icon: GlobeIcon,
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
    icon: TerminalIcon,
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
    icon: FolderIcon,
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
    icon: CodeIcon,
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
    icon: CatIcon,
    mainWindow: { viewId: 'main' },
    views: {
      main: { kind: 'window', component: lazy(() => import('./kita/KitaApp.tsx').then((module) => ({ default: module.KitaApp }))) },
      status: { kind: 'widget', component: lazy(() => import('./kita/KitaWidget.tsx').then((module) => ({ default: module.KitaWidget }))) },
    },
    widgets: { status: { name: '喜多', viewId: 'status', sizes: ['2x2', '4x2', '4x4'] } },
  },
  {
    id: 'system',
    icon: GaugeIcon,
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
