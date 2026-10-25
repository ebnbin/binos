import { describe, expect, it } from 'vitest'
import { dockMotion } from './dock-gesture.ts'

describe('dockMotion', () => {
  it('往屏幕里滑：底部是往上，左边的 Dock 是往右，右边的是往左', () => {
    expect(dockMotion('bottom', 0, -40)).toMatchObject({ axis: 'inward', inward: 40 })
    expect(dockMotion('left', 40, 0)).toMatchObject({ axis: 'inward', inward: 40 })
    expect(dockMotion('right', -40, 0)).toMatchObject({ axis: 'inward', inward: 40 })
    expect(dockMotion('right', 40, 0).axis).toBe('outward')
  })

  it('沿 Dock 滑：底部看左右，侧边看上下', () => {
    expect(dockMotion('bottom', -50, 10)).toMatchObject({ axis: 'along', along: -50 })
    expect(dockMotion('left', 10, 50)).toMatchObject({ axis: 'along', along: 50 })
  })
})
