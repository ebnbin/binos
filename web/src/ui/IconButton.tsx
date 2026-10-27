import type { Icon } from '@phosphor-icons/react'
import type { ButtonHTMLAttributes } from 'react'
import styles from './IconButton.module.css'

export function IconButton({
  icon: Icon,
  label,
  className,
  ...props
}: { icon: Icon; label: string } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" aria-label={label} title={label} className={`${styles.button} ${className ?? ''}`} {...props}>
      <Icon size={19} />
    </button>
  )
}
