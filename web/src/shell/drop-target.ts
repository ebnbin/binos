// 长按 Dock 上的 app 图标后能放下的位置：取消、取消分屏、关闭或在新标签页打开某个窗口、分屏到某一侧。
// 放置位置在页面上用 data-drop 标出，拖动时按手指下面的元素找
export type DropTarget = { type: 'cancel' } | { type: 'unsplit' } | { type: 'close' | 'external'; id: string } | { type: 'split'; at: number }

export const dropKey = (target: DropTarget) => 'id' in target ? `${target.type}:${target.id}` : 'at' in target ? `split:${target.at}` : target.type

export function parseDrop(key: string): DropTarget {
  const [type, value] = key.split(':')
  if (type === 'split') return { type, at: Number(value) }
  if (type === 'close' || type === 'external') return { type, id: value }
  if (type === 'unsplit') return { type }
  return { type: 'cancel' }
}
