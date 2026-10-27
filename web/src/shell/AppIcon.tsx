import type { ApplicationDefinition } from '../apps/types.ts'
import styles from './AppIcon.module.css'

// 外部 app 没有指定颜色，按 id 在几种系统色里取一个，同一个 app 每次一样
const tints = 6
const tintOf = (id: string) => [...id].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 0) % tints

// Apple 风格的 app 图标：系统色渐变的超椭圆底，白色图形。大小跟随父元素的 font-size
export function AppIcon({ app, className }: { app: ApplicationDefinition; className?: string }) {
  return (
    <span className={`${styles.icon} ${className ?? ''}`} data-app={app.id} data-tint={tintOf(app.id)} aria-hidden>
      <app.icon />
    </span>
  )
}
