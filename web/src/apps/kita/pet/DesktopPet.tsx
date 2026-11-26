import { useEffect, useRef } from 'react'
import { startPet } from './engine.ts'
import { kita } from './kita.ts'
import styles from './DesktopPet.module.css'

// 喜多在桌面上走来走去：画在图标上面，只有指到猫身上时才接住鼠标
export default function DesktopPet() {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const element = canvas.current
    const surface = element?.parentElement
    if (!element || !surface) {
      return
    }
    return startPet(element, surface, kita)
  }, [])
  return <canvas ref={canvas} className={styles.pet} aria-hidden />
}
