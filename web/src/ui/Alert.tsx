import { WarningCircleIcon } from '@phosphor-icons/react'
import type { ReactNode } from 'react'
import styles from './Alert.module.css'

export function Alert({ children }: { children: ReactNode }) {
  return (
    <div className={styles.alert} role="alert">
      <WarningCircleIcon size={15} className={styles.icon} />
      <span>{children}</span>
    </div>
  )
}
