import { useEffect } from 'react'
import type { RefObject } from 'react'

// 点过或按过键之后这么久里的变高是用户展开了什么，不跟
const interactionWindow = 1000

// stick 为 true（停在底部）时，内容后来变高了（图片加载、代码高亮、出图、窗口变窄）也继续贴着底部。scrollRef 是滚动的那一层，内容是它的第一个子元素
export function useFollowBottom(scrollRef: RefObject<HTMLElement | null>, stick: RefObject<boolean>) {
  useEffect(() => {
    const scroller = scrollRef.current
    const content = scroller?.firstElementChild
    if (!scroller || !content) {
      return
    }
    let interactedAt = 0
    const interact = () => {
      interactedAt = Date.now()
    }
    const observer = new ResizeObserver(() => {
      if (stick.current && Date.now() - interactedAt > interactionWindow) {
        scroller.scrollTop = scroller.scrollHeight
      }
    })
    observer.observe(content)
    scroller.addEventListener('pointerdown', interact)
    scroller.addEventListener('keydown', interact)
    return () => {
      observer.disconnect()
      scroller.removeEventListener('pointerdown', interact)
      scroller.removeEventListener('keydown', interact)
    }
  }, [scrollRef, stick])
}
