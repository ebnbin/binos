import { useEffect, useRef, useState } from 'react'
import type { UIEvent } from 'react'

// 手机上 Dock 在底部时，打开 app 后平时缩成底部安全区里的一颗胶囊，把高度留给 app。
// 外部 app 在 iframe 里，滚动传不出来，只能靠没有操作一段时间后自动收起
const idleDelay = 4000
const scrollThreshold = 24

export function useDockCapsule(enabled: boolean, home: boolean) {
  const [expanded, setExpanded] = useState(false)
  const [activity, setActivity] = useState(0)
  const [previousHome, setPreviousHome] = useState(home)
  if (previousHome !== home) {
    setPreviousHome(home)
    setExpanded(false)
  }
  const dock = useRef<HTMLElement>(null)
  const offsets = useRef(new WeakMap<Element, number>())
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
    return () => window.clearTimeout(timer)
  }, [active, expanded, activity])

  // 只比较竖直方向：往下滚收起，往上滚展开。滚过阈值才算数，回弹超出的部分不算
  const onScroll = (event: UIEvent) => {
    const target = event.target
    if (!(target instanceof Element)) return
    const top = Math.min(Math.max(0, target.scrollTop), target.scrollHeight - target.clientHeight)
    const last = offsets.current.get(target)
    if (last !== undefined && Math.abs(top - last) < scrollThreshold) return
    offsets.current.set(target, top)
    if (last !== undefined && active) setExpanded(top < last)
  }

  return {
    collapsed: active && !expanded,
    dock,
    onScroll,
    expand: () => setExpanded(true),
    collapse: () => setExpanded(false),
    touch: () => setActivity((value) => value + 1),
  }
}
