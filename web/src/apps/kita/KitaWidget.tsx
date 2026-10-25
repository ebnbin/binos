import { useApplications } from '../registry.ts'
import type { WidgetContext } from '../types.ts'
import { Avatar } from './Avatar.tsx'
import styles from './KitaWidget.module.css'
import { kitaStatus } from './status.ts'
import { useKita } from './useKita.ts'

export function KitaWidget({ size, open }: WidgetContext) {
  const { profile, activity } = useKita()
  const status = kitaStatus(activity, useApplications())
  return (
    <button type="button" className={styles.widget} data-size={size} onClick={() => open('/')}>
      <Avatar profile={profile} size={size === '4x4' ? 120 : 64} busy={status.busy} />
      <span className={styles.text}>
        <strong>喜多</strong>
        <small>{status.label}</small>
      </span>
    </button>
  )
}
