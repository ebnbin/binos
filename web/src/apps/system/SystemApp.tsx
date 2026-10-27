import { ArrowsClockwiseIcon, MonitorIcon, PulseIcon, RobotIcon } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import { useApplications } from '../index.ts'
import type { WindowContext } from '../types.ts'
import { AgentAccounts } from './AgentAccounts.tsx'
import { BinosMonitor } from './BinosMonitor.tsx'
import { HostMonitor } from './HostMonitor.tsx'
import { moment } from './format.ts'
import { systemRequest, useMonitor } from './monitor.ts'
import styles from './MonitorIcon.module.css'

export function SystemApp({ ctx }: { ctx: WindowContext }) {
  const { status, error, lastSuccess, now } = useMonitor()
  const [refreshing, setRefreshing] = useState(false)
  const [actionError, setActionError] = useState('')
  const apps = useApplications().filter((app) => app.settings)
  const app = apps.find((item) => ctx.route === `/apps/${item.id}`)
  const section = ctx.route === '/agent' ? 'agent' : ctx.route.startsWith('/binos') || app ? 'binos' : 'host'

  const { setTitle } = ctx
  useEffect(() => setTitle(section === 'host' ? '宿主 Mac' : section === 'agent' ? 'Agent' : 'binOS'), [setTitle, section])
  const snapshot = status?.snapshot
  const stale = snapshot && now - snapshot.at > 30_000
  const refresh = async () => {
    setRefreshing(true)
    setActionError('')
    try {
      // 采样完成后的状态由推送送来
      await systemRequest('/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' } })
    } catch (e) {
      setActionError(String(e))
    } finally {
      setRefreshing(false)
    }
  }
  const Settings = app?.settings?.component
  return (
    <div className={styles.app}>
      <header className={styles.top}>
        <div className={styles.heading}>
          <strong>系统</strong>
          <span className={styles.freshness} data-stale={!!error || stale || !!status?.collectionError}>
            {error ? '监控连接异常' : stale ? '数据已过期' : status?.collectionError ? '采集异常' : snapshot ? '正在监控' : '首次采集中'}
            <small>{snapshot ? `采样 ${new Date(snapshot.at).toLocaleTimeString('zh-CN')}` : ''}</small>
          </span>
        </div>
        <nav className={styles.sections} aria-label="系统分区">
          {[
            { id: 'host', name: '宿主 Mac', hint: '硬件与 macOS', icon: MonitorIcon, route: '/' },
            { id: 'agent', name: 'Agent', hint: '账号与额度', icon: RobotIcon, route: '/agent' },
            { id: 'binos', name: 'binOS', hint: '运行与维护', icon: PulseIcon, route: '/binos' },
          ].map((item) => (
            <button
              key={item.id}
              className={styles.segment}
              title={item.hint}
              aria-current={section === item.id ? 'page' : undefined}
              data-selected={section === item.id}
              onClick={() => ctx.navigate(item.route)}
            >
              <item.icon size={14} aria-hidden />
              {item.name}
            </button>
          ))}
        </nav>
        <div className={styles.actions}>
          <button className={styles.refresh} title="立即采集" aria-label="立即采集" disabled={refreshing} onClick={() => void refresh()}>
            <ArrowsClockwiseIcon size={16} className={refreshing ? styles.spin : ''} />
          </button>
        </div>
      </header>
      {(error || stale || actionError) && (
        <div className={styles.warning} role="alert">
          {actionError || error || '监控采样超过 30 秒未更新'}。
          {error || stale ? `最后成功连接 ${moment(lastSuccess)}；保留的数据可能已过期，无法确认宿主当前正常。` : ''}
        </div>
      )}
      {status?.collectionError && (
        <div className={styles.warning} role="alert">
          {status.collectionError}
        </div>
      )}
      <div className={styles.body}>
        {section === 'agent' ? (
          <AgentAccounts back={() => ctx.navigate('/')} />
        ) : section === 'binos' ? (
          Settings ? (
            <Settings back={() => ctx.navigate('/binos')} />
          ) : (
            <BinosMonitor status={status} navigate={ctx.navigate} />
          )
        ) : status ? (
          <HostMonitor status={status} />
        ) : (
          <p className={styles.empty}>{error ? '暂时无法读取宿主状态。页面会自动重试。' : '正在连接宿主监控…'}</p>
        )}
      </div>
    </div>
  )
}
