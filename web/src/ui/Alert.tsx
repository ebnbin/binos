import { CircleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import styles from './Alert.module.css'

export function Alert({ children }: { children: ReactNode }) {
  return (
    <div className={styles.alert} role="alert">
      <CircleAlert size={15} strokeWidth={2} className={styles.icon} />
      <span>{children}</span>
    </div>
  )
}
