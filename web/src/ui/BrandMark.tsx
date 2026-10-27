import source from '../../../design/logo.svg?raw'
import { logoVariant } from '../logo.ts'
import styles from './BrandMark.module.css'

const svg = logoVariant(source, { rounded: true })

// inverted：放在外框的纯黑底上，不跟随深浅色
export function BrandMark({ size = 24, inverted = false }: { size?: number; inverted?: boolean }) {
  return <span className={styles.mark} data-inverted={inverted || undefined} style={{ width: size, height: size }} aria-hidden dangerouslySetInnerHTML={{ __html: svg }} />
}
