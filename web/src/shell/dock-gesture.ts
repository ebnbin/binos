import { useRef } from 'react'
import type { MouseEvent, PointerEvent } from 'react'
import type { BarPlacement } from './bar-placement.ts'

// 移动不到这么远就抬起是点击，按住不动是长按
const slop = 10
const longPressDelay = 500
// 沿 Dock 每滑过这么远切换一个窗口
const stepDistance = 48
const homeDistance = 32

export type DockAxis = 'along' | 'inward' | 'outward'

// 手指的位移拆成沿 Dock 的分量（往右或往下为正）和往屏幕里面的分量
export function dockMotion(placement: Exclude<BarPlacement, 'hidden'>, dx: number, dy: number) {
  const along = placement === 'bottom' ? dx : dy
  const inward = placement === 'bottom' ? -dy : placement === 'left' ? dx : -dx
  const axis: DockAxis = Math.abs(along) >= Math.abs(inward) ? 'along' : inward > 0 ? 'inward' : 'outward'
  return { along, inward, axis }
}

type Gesture = {
  pointer: number
  x: number
  y: number
  axis: DockAxis | null
  // 开着的 app 多到能滚动时，在这一段里沿 Dock 滑动交给浏览器滚动
  scrolls: boolean
  stepped: number
  timer: number
}

// 触屏上从 Dock 开始的手势：沿 Dock 滑动切换窗口，往屏幕里滑回到桌面，长按 app 图标。滑动或长按之后不再触发点击
export function useDockGesture({
  placement,
  scrolls,
  onStep,
  onHome,
  onLongPress,
}: {
  placement: Exclude<BarPlacement, 'hidden'>
  scrolls: (target: Element) => boolean
  onStep: (steps: number) => void
  onHome: () => void
  onLongPress: (target: Element) => boolean
}) {
  const gesture = useRef<Gesture | null>(null)
  const swallowClick = useRef(false)

  const end = () => {
    if (gesture.current) window.clearTimeout(gesture.current.timer)
    gesture.current = null
  }

  return {
    onPointerDown(event: PointerEvent) {
      swallowClick.current = false
      end()
      if (event.pointerType === 'mouse' || !event.isPrimary || !(event.target instanceof Element)) return
      const target = event.target
      gesture.current = {
        pointer: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        axis: null,
        scrolls: scrolls(target),
        stepped: 0,
        timer: window.setTimeout(() => {
          if (onLongPress(target)) {
            swallowClick.current = true
            end()
          }
        }, longPressDelay),
      }
    },
    onPointerMove(event: PointerEvent) {
      const current = gesture.current
      if (!current || current.pointer !== event.pointerId) return
      const motion = dockMotion(placement, event.clientX - current.x, event.clientY - current.y)
      if (!current.axis) {
        if (Math.hypot(motion.along, motion.inward) < slop) return
        window.clearTimeout(current.timer)
        swallowClick.current = true
        current.axis = motion.axis
        if (current.axis === 'along' && current.scrolls) {
          end()
          return
        }
      }
      if (current.axis === 'along') {
        const steps = Math.trunc(motion.along / stepDistance) - current.stepped
        if (steps !== 0) {
          current.stepped += steps
          onStep(steps)
        }
      } else if (current.axis === 'inward' && motion.inward >= homeDistance) {
        onHome()
        end()
      }
    },
    onPointerUp: end,
    onPointerCancel: end,
    onClickCapture(event: MouseEvent) {
      if (!swallowClick.current) return
      swallowClick.current = false
      event.preventDefault()
      event.stopPropagation()
    },
  }
}
