import type { MonitorStatus } from '@binos/server/apps/system/types'
import { ChevronRight } from 'lucide-react'
import { useConnected } from '../../events.ts'
import { useApplications } from '../index.ts'
import { ExternalApps } from './ExternalApps.tsx'
import { bytes } from './format.ts'
import styles from './Monitor.module.css'

export function BinosMonitor({ status, navigate }: { status?: MonitorStatus; navigate(route: string): void }) {
  const connected = useConnected()
  const apps = useApplications().filter((app) => app.settings)
  const runtime = status?.snapshot?.runtime
  return (
    <div className={styles.content}>
      <header className={styles.hero}>
        <h1>binOS</h1>
        <p>系统状态与应用设置</p>
      </header>
      <section className={styles.section}>
        <dl className={styles.rows}>
          <div className={styles.field}>
            <dt>连接状态</dt>
            <dd>
              <span className={styles.dot} data-ok={connected} />
              {connected ? '已连接' : '连接已断开'}
            </dd>
          </div>
          <div className={styles.field}>
            <dt>版本</dt>
            <dd className={styles.mono} title={runtime?.version}>
              {runtime?.version.slice(0, 7) || '读取中'}
            </dd>
          </div>
          <div className={styles.field}>
            <dt>运行环境</dt>
            <dd>{runtime ? (runtime.test ? '测试 / 预览' : '正式版') : '读取中'}</dd>
          </div>
          <div className={styles.field}>
            <dt>已运行</dt>
            <dd>{runtime ? `${Math.floor(runtime.uptime / 3600)} 小时 ${Math.floor((runtime.uptime % 3600) / 60)} 分钟` : '读取中'}</dd>
          </div>
          <div className={styles.field}>
            <dt>binOS 内存占用</dt>
            <dd>{bytes(runtime?.memory)}</dd>
          </div>
        </dl>
      </section>
      {apps.length > 0 && (
        <section className={styles.section}>
          <h2>应用设置</h2>
          <div className={styles.group}>
            {apps.map((app) => (
              <button className={styles.settingLink} key={app.id} onClick={() => navigate(`/apps/${app.id}`)}>
                {app.name}
                <span>{app.settings!.hint}</span>
                <ChevronRight size={14} strokeWidth={2} aria-hidden />
              </button>
            ))}
          </div>
        </section>
      )}
      <ExternalApps />
    </div>
  )
}
