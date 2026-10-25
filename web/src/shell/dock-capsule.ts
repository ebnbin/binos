import { useEffect, useRef, useState } from 'react'

// 手机上 Dock 在底部时，打开 app 后平时缩成底部安全区里的一颗胶囊，把高度留给 app。
// 展开后，在 Dock 以外按下或者焦点移到 Dock 以外就收起。外部 app 在 iframe 里，按下事件传不出来，
// 只能从页面失去焦点、焦点落在 iframe 上看出来
export function useDockCapsule(enabled: boolean, home: boolean) {
  const [expanded, setExpanded] = useState(false)
  const [previousHome, setPreviousHome] = useState(home)
  if (previousHome !== home) {
    setPreviousHome(home)
    setExpanded(false)
  }
  const dock = useRef<HTMLElement>(null)
  const active = enabled && !home

  useEffect(() => {
    if (!active || !expanded) return
    const outside = (event: Event) => {
      if (!(event.target instanceof Node && dock.current?.contains(event.target))) setExpanded(false)
    }
    // 失去焦点时 activeElement 还没换成 iframe，等这一轮事件结束再读
    const blur = () => window.setTimeout(() => {
      if (document.activeElement instanceof HTMLIFrameElement) setExpanded(false)
    })
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('focusin', outside)
    window.addEventListener('blur', blur)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('focusin', outside)
      window.removeEventListener('blur', blur)
    }
  }, [active, expanded])

  return {
    collapsed: active && !expanded,
    dock,
    expand: () => setExpanded(true),
    collapse: () => setExpanded(false),
  }
}
