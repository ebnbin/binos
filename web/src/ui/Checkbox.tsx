import * as Primitive from '@radix-ui/react-checkbox'
import { CheckIcon } from '@phosphor-icons/react'
import styles from './Checkbox.module.css'

export function Checkbox({ checked, onCheckedChange, label }: { checked: boolean; onCheckedChange: (checked: boolean) => void; label: string }) {
  return (
    <label className={styles.label}>
      <Primitive.Root className={styles.control} checked={checked} onCheckedChange={(value) => onCheckedChange(value === true)}>
        <Primitive.Indicator className={styles.indicator}><CheckIcon weight="bold" /></Primitive.Indicator>
      </Primitive.Root>
      {label}
    </label>
  )
}
