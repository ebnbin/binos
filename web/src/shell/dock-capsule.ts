import { useEffect, useRef, useState } from 'react'
import type { PointerEvent } from 'react'

// 手机上 Dock 在底部时，平时缩成底部安全区里的一颗胶囊，把高度留给桌面和 app。
// 展开后在 Dock 以外按下、在 Dock 上往下滑，或者一段时间没有操作就收起；在 Dock 上切换 app、手指按在 Dock 上、开着窗口菜单时不收起。外部 app 在 iframe 里，按下事件传不出来，只能等时间到
const idleDelay = 3000
const swipeDistance = 24

export function useDockCapsule(enabled: boolean, home: boolean) {
  const [expanded, setExpanded] = useState(true)
  const [activity, setActivity] = useState(0)
  const [holding, setHolding] = useState(false)
  // 窗口菜单在 Dock 外面，点菜单不算点到 Dock 以外
  const [menu, setMenu] = useState(false)
  const [previousHome, setPreviousHome] = useState(home)
  if (previousHome !== home) {
    // 在桌面和 app 之间切换时 Dock 先保持展开，时间到了再收起
    setPreviousHome(home)
    setExpanded(true)
  }
  const dock = useRef<HTMLElement>(null)
  const swipe = useRef<{ id: number; x: number; y: number } | null>(null)

  // 在 app 那一段里横着拖时浏览器接管滚动，只发 pointercancel，手指其实还按着：触摸看 touchend，鼠标看 pointerup
  useEffect(() => {
    if (!holding) return
    const release = () => {
      setHolding(false)
      setActivity((value) => value + 1)
    }
    const pointerUp = (event: globalThis.PointerEvent) => {
      if (event.pointerType !== 'touch') release()
    }
    window.addEventListener('pointerup', pointerUp)
    window.addEventListener('touchend', release)
    window.addEventListener('touchcancel', release)
    return () => {
      window.removeEventListener('pointerup', pointerUp)
      window.removeEventListener('touchend', release)
      window.removeEventListener('touchcancel', release)
    }
  }, [holding])

  useEffect(() => {
    if (!enabled || !expanded || holding || menu) return
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
  }, [enabled, expanded, activity, holding, menu])

  const touch = () => setActivity((value) => value + 1)

  return {
    collapsed: enabled && !expanded,
    dock,
    expand: () => setExpanded(true),
    touch,
    onMenu: (open: boolean) => {
      setMenu(open)
      if (!open) touch()
    },
    onPointerDown: (event: PointerEvent) => {
      setHolding(true)
      swipe.current = { id: event.pointerId, x: event.clientX, y: event.clientY }
    },
    onPointerMove: (event: PointerEvent) => {
      const start = swipe.current
      if (!start || start.id !== event.pointerId) return
      const dy = event.clientY - start.y
      if (dy > swipeDistance && dy > Math.abs(event.clientX - start.x)) {
        swipe.current = null
        setMenu(false)
        setExpanded(false)
      }
    },
    onPointerEnd: () => {
      swipe.current = null
    },
  }
}
