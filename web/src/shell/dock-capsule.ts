import { useEffect, useRef, useState } from 'react'
import type { PointerEvent } from 'react'

// 手机上 Dock 在底部时，打开 app 后平时缩成底部安全区里的一颗胶囊，把高度留给 app。
// 展开后在 Dock 以外按下、在 Dock 上往下滑，或者一段时间没有操作就收起；在 Dock 上切换 app 不收起。外部 app 在 iframe 里，按下事件传不出来，只能等时间到
const idleDelay = 3000
const swipeDistance = 24

export function useDockCapsule(enabled: boolean, home: boolean) {
  const [expanded, setExpanded] = useState(false)
  const [activity, setActivity] = useState(0)
  const [previousHome, setPreviousHome] = useState(home)
  if (previousHome !== home) {
    // 从桌面进入 app 时 Dock 先保持展开，时间到了再收起
    setPreviousHome(home)
    setExpanded(true)
  }
  const dock = useRef<HTMLElement>(null)
  const swipe = useRef<{ id: number; x: number; y: number } | null>(null)
  const active = enabled && !home

  useEffect(() => {
    if (!active || !expanded) return
    const timer = window.setTimeout(() => {
      // 键盘焦点还在 Dock 上时不收起
      const focus = document.activeElement
      if (focus && dock.current?.contains(focus) && focus.matches(':focus-visible')) {
        setActivity((value) => value + 1)
      } else {
        setExpanded(false)
      }
    }, idleDelay)
    const outside = (event: Event) => {
      if (!(event.target instanceof Node && dock.current?.contains(event.target))) setExpanded(false)
    }
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('focusin', outside)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('focusin', outside)
    }
  }, [active, expanded, activity])

  const touch = () => setActivity((value) => value + 1)

  return {
    collapsed: active && !expanded,
    dock,
    expand: () => setExpanded(true),
    touch,
    onPointerDown: (event: PointerEvent) => {
      touch()
      swipe.current = { id: event.pointerId, x: event.clientX, y: event.clientY }
    },
    onPointerMove: (event: PointerEvent) => {
      const start = swipe.current
      if (!start || start.id !== event.pointerId) return
      const dy = event.clientY - start.y
      if (dy > swipeDistance && dy > Math.abs(event.clientX - start.x)) {
        swipe.current = null
        setExpanded(false)
      }
    },
    onPointerEnd: () => {
      swipe.current = null
    },
  }
}
