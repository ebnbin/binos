import type { Profile } from '@binos/server/services/kita/types'
import { Cat } from 'lucide-react'
import type { CSSProperties } from 'react'
import { photoUrl } from '../../services/kita/api.ts'
import styles from './Avatar.module.css'

// 头像是用户选的喜多的照片；还没有照片时只显示 app 的图标，不另画一个形象。busy：喜多在某个 app 里回答
export function Avatar({ profile, size, busy }: { profile: Profile | undefined; size: number; busy?: boolean }) {
  return (
    <span className={styles.avatar} style={{ '--avatar-size': `${size}px` } as CSSProperties} data-busy={busy || undefined}>
      {profile?.avatar ? (
        <img src={photoUrl(profile.avatar)} alt="喜多" draggable={false} />
      ) : (
        <Cat size={Math.round(size * 0.55)} strokeWidth={1.5} aria-label="喜多" />
      )}
    </span>
  )
}
