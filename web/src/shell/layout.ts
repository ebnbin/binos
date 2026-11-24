import type { JsonValue } from '../json.ts'

// 桌面分栏和窗口分屏的规格，只做计算，不读写存储

export type Size = { width: number; height: number }

// 桌面一栏宽 360～480，放 4 个图标格；最多 3 栏，再宽的空间平分到左右两边
export const column = { min: 360, max: 480, maxCount: 3 }

export function desktopColumns(width: number) {
  const count = Math.max(1, Math.min(column.maxCount, Math.floor(width / column.min)))
  const columnWidth = Math.min(width / count, column.max)
  return { count, columnWidth, scale: columnWidth / column.min }
}

// 一栏宽 4 格
export const columnCells = 4

export type Placement = { row: number; column: number; width: number; height: number }

// 按顺序放进一栏：每一个从上一个的后面开始，找第一个放得下的位置，不回头填前面的空，所以顺序不会变
export function packColumn(sizes: Size[]): { placements: Placement[]; rows: number } {
  const taken: boolean[][] = []
  const free = (row: number, col: number, size: Size) => {
    for (let r = row; r < row + size.height; r++) {
      for (let c = col; c < col + size.width; c++) {
        if (taken[r]?.[c]) {
          return false
        }
      }
    }
    return true
  }
  let cursor = { row: 0, column: 0 }
  let rows = 0
  const placements = sizes.map((size) => {
    let { row, column: col } = cursor
    while (col + size.width > columnCells || !free(row, col, size)) {
      col += 1
      if (col + size.width > columnCells) {
        row += 1
        col = 0
      }
    }
    for (let r = row; r < row + size.height; r++) {
      taken[r] ??= []
      for (let c = col; c < col + size.width; c++) {
        taken[r][c] = true
      }
    }
    cursor = { row, column: col + size.width }
    rows = Math.max(rows, row + size.height)
    return { row, column: col, width: size.width, height: size.height }
  })
  return { placements, rows }
}

// 按顺序把内容切成 count 段，第 1 段放第 1 栏，依次往右。
// 选最高的那一栏最矮的切法，这样各栏一样高，放不下时整个桌面一起滚动；
// 一样矮时选空格最少的，再一样时让前面的栏多放
export function splitColumns(sizes: Size[], count: number): number[] {
  const rows = new Map<string, number>()
  const rowsOf = (start: number, end: number) => {
    const key = `${start}-${end}`
    if (!rows.has(key)) {
      rows.set(key, packColumn(sizes.slice(start, end)).rows)
    }
    return rows.get(key)!
  }
  const best: { starts: number[]; heights: number[] | null } = { starts: [0], heights: null }
  const better = (heights: number[], than: number[]) => {
    const key = (list: number[]) => [Math.max(...list), list.reduce((sum, value) => sum + value, 0), ...list.map((value) => -value)]
    const a = key(heights)
    const b = key(than)
    const index = a.findIndex((value, i) => value !== b[i])
    return index >= 0 && a[index] < b[index]
  }
  const search = (starts: number[]) => {
    if (starts.length === count) {
      const bounds = [...starts, sizes.length]
      const heights = starts.map((start, index) => rowsOf(start, bounds[index + 1]))
      if (!best.heights || better(heights, best.heights)) {
        best.starts = starts
        best.heights = heights
      }
      return
    }
    for (let start = starts.at(-1)!; start <= sizes.length; start++) {
      search([...starts, start])
    }
  }
  search([0])
  return best.starts
}

// 横屏左右分，竖屏上下分；不均分时较小窗口固定为最小尺寸。
export type LayoutId = '1' | '1:1' | '1:2' | '2:1'
export const layouts: Record<LayoutId, number[]> = {
  '1': [1],
  '1:1': [1, 1],
  '1:2': [1, 2],
  '2:1': [2, 1],
}
export const layoutIds = Object.keys(layouts) as LayoutId[]
export const maxPanes = 2

// 分屏时每个窗口至少这么大；只有一个窗口时不限制
export const minPane = 360
// 分屏时窗口之间的黑缝。每个窗口是独立的圆角矩形，缝不占窗口自己的尺寸
export const paneGap = 6
// 两种不均分布局之间至少留出 90px 的拖动距离
const splitBuffer = 90

export const isPortrait = (size: Size) => size.height > size.width

function canEqualSplit(length: number) {
  return length - paneGap >= minPane * 3
}

export function snapLayout(position: number, length: number): LayoutId {
  const available = length - paneGap
  const positions: [LayoutId, number][] = [['1:2', minPane], ['1:1', available / 2], ['2:1', available - minPane]]
  const candidates = positions.filter(([id]) => id !== '1:1' || canEqualSplit(length))
  return candidates.reduce((best, option) => Math.abs(option[1] + paneGap / 2 - position) < Math.abs(best[1] + paneGap / 2 - position) ? option : best)[0]
}

export function paneSizes(layout: LayoutId, size: Size): Size[] {
  if (layout === '1') return [size]
  const portrait = isPortrait(size)
  const available = (portrait ? size.height : size.width) - paneGap
  const first = layout === '1:2' ? minPane : layout === '2:1' ? available - minPane : available / 2
  return [first, available - first].map((length) => portrait ? { width: size.width, height: length } : { width: length, height: size.height })
}

export function allowedLayouts(size: Size): LayoutId[] {
  const portrait = isPortrait(size)
  const length = portrait ? size.height : size.width
  if (length < minPane * 2 + paneGap + splitBuffer) return ['1']
  const equal = canEqualSplit(length)
  return layoutIds.filter(
    (id) => id === '1' || (id !== '1:1' || equal) && paneSizes(id, size).every((pane) => pane.width >= minPane && pane.height >= minPane),
  )
}

// 均分不可用时让指定位置占较大区域；分屏放不下时降为一个
export function fitLayout(layout: LayoutId, allowed: LayoutId[], preferred = 0): LayoutId {
  if (allowed.includes(layout)) {
    return layout
  }
  if (layout === '1') return '1'
  const fallback = preferred === 1 ? '1:2' : '2:1'
  return allowed.includes(fallback) ? fallback : '1'
}

// 选的分屏布局和每个位置上的窗口 id（见 windows.ts）
export type Workspace = { layout: LayoutId; slots: (string | null)[] }

export function normalizeWorkspace(value: JsonValue, ids: string[]): Workspace {
  const stored = value as Partial<Workspace> | null
  const layout = stored?.layout && stored.layout in layouts ? stored.layout : '1'
  const slots = Array.from({ length: maxPanes }, (_, index) => {
    const id = stored?.slots?.[index]
    return id && ids.includes(id) && stored?.slots?.indexOf(id) === index ? id : null
  })
  return { layout: layout !== '1' && slots.every((id) => id === null) ? '1' : layout, slots }
}

// 实际显示的窗口。只有一个位置时显示聚焦的窗口，不动记下的布局；分屏时按记下的位置
export function arrange(workspace: Workspace, layout: LayoutId, focused: string | null): (string | null)[] {
  const count = layouts[layout].length
  if (count === 1) {
    return [focused ?? workspace.slots.find((id) => id !== null) ?? null]
  }
  return workspace.slots.slice(0, count)
}

export type SplitGroup = Workspace & { id: string; slots: [string, string] }

export function normalizeGroups(value: JsonValue, ids: string[]): SplitGroup[] {
  if (!Array.isArray(value)) return []
  const used = new Set<string>()
  const groupIds = new Set<string>()
  return value.flatMap((item) => {
    const workspace = normalizeWorkspace(item, ids)
    const id = (item as { id?: string } | null)?.id
    const [first, second] = workspace.slots
    if (typeof id !== 'string' || groupIds.has(id) || workspace.layout === '1' || !first || !second || used.has(first) || used.has(second)) return []
    used.add(first)
    used.add(second)
    groupIds.add(id)
    return [{ id, layout: workspace.layout, slots: [first, second] as [string, string] }]
  })
}
