import * as Primitive from '@radix-ui/react-select'
import { Check, ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react'
import styles from './Select.module.css'

type Option = { value: string; label: string; disabled?: boolean }

export function Select({ value, options, onValueChange, label, title, disabled, className }: {
  value: string
  options: Option[]
  onValueChange: (value: string) => void
  label: string
  title?: string
  disabled?: boolean
  className?: string
}) {
  // Radix 的空字符串用于清除选择；加前缀让业务里的默认选项也能被选中。
  const encode = (value: string) => `option:${value}`
  return (
    <Primitive.Root value={encode(value)} onValueChange={(next) => onValueChange(next.slice(7))} disabled={disabled}>
      <Primitive.Trigger aria-label={label} title={title} className={`${styles.trigger} ${className ?? ''}`}>
        <span className={styles.value}><Primitive.Value /></span>
        <Primitive.Icon className={styles.icon}><ChevronsUpDown size={12} strokeWidth={2.25} /></Primitive.Icon>
      </Primitive.Trigger>
      <Primitive.Portal>
        <Primitive.Content className={styles.content} position="popper" sideOffset={4} collisionPadding={8}>
          <Primitive.ScrollUpButton className={styles.scroll}><ChevronUp size={14} /></Primitive.ScrollUpButton>
          <Primitive.Viewport className={styles.viewport}>
            {options.map((option) => (
              <Primitive.Item key={option.value} value={encode(option.value)} disabled={option.disabled} className={styles.item}>
                <Primitive.ItemIndicator className={styles.indicator}><Check size={13} strokeWidth={2.5} /></Primitive.ItemIndicator>
                <Primitive.ItemText>{option.label}</Primitive.ItemText>
              </Primitive.Item>
            ))}
          </Primitive.Viewport>
          <Primitive.ScrollDownButton className={styles.scroll}><ChevronDown size={14} /></Primitive.ScrollDownButton>
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  )
}
