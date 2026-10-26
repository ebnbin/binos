import * as Primitive from '@radix-ui/react-popover'
import type { ReactElement, ReactNode } from 'react'
import styles from './Popover.module.css'

export function Popover({
  trigger,
  label,
  children,
  open,
  onOpenChange,
  className,
  side = 'bottom',
  align = 'end',
}: {
  trigger: ReactElement
  label: string
  children: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
  className?: string
  side?: 'top' | 'bottom' | 'left' | 'right'
  align?: 'start' | 'center' | 'end'
}) {
  return (
    <Primitive.Root open={open} onOpenChange={onOpenChange}>
      <Primitive.Trigger asChild>{trigger}</Primitive.Trigger>
      <Primitive.Portal>
        <Primitive.Content
          aria-label={label}
          side={side}
          align={align}
          sideOffset={8}
          collisionPadding={12}
          className={`${styles.content} ${className ?? ''}`}
        >
          {children}
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  )
}
