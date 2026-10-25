import type { MonitorStatus } from '@binos/server/apps/system/types'
import { Cpu, HardDrive, MemoryStick, Network, PlugZap } from 'lucide-react'
import { bytes } from './format.ts'
import styles from './Monitor.module.css'

const pressureNames = { normal: '正常', warning: '偏高', critical: '很高', unknown: '未知' }
export function HostMonitor({ status }: { status: MonitorStatus }) {
  const s = status.snapshot
  if (!s) return <p className={styles.empty}>正在读取 Mac 状态…</p>
  const usedMemory = s.memory.cached === null ? null : Math.max(0, s.memory.total - s.memory.free - s.memory.cached)
  const cpu = s.cpu.percent
  const uptime = s.host.uptime
  return (
    <div className={styles.content}>
      <header className={styles.hero}>
        <h1>{s.host.name}</h1>
        <p>
          {s.host.chip} · {s.host.cores} 核 · {s.host.os}
        </p>
      </header>
      {s.unavailable.length > 0 && <p className={styles.warning}>{s.unavailable.join('、')}暂时无法读取，其他信息仍会更新。</p>}
      <div className={styles.cards}>
        <section className={styles.card} data-metric="cpu">
          <h2>
            <Cpu size={16} strokeWidth={1.75} />
            CPU
          </h2>
          <strong>{cpu === null ? '采样中' : `${cpu.toFixed(0)}%`}</strong>
          <progress className={styles.meter} aria-label="CPU 使用率" max={100} value={cpu || 0} />
          <p>当前总使用率</p>
        </section>
        <section className={styles.card} data-metric="memory">
          <h2>
            <MemoryStick size={16} strokeWidth={1.75} />
            内存
          </h2>
          <strong>
            {bytes(usedMemory)}
            <small> / {bytes(s.memory.total)}</small>
          </strong>
          {usedMemory !== null && (
            <progress className={styles.meter} data-pressure={s.memory.pressure} aria-label="内存使用量" max={s.memory.total} value={usedMemory} />
          )}
          <p>
            内存压力：
            <span className={s.memory.pressure === 'warning' || s.memory.pressure === 'critical' ? styles.bad : ''}>{pressureNames[s.memory.pressure]}</span>
          </p>
          <small className={styles.note}>已用量扣除文件缓存，为估算值。</small>
        </section>
        <section className={styles.card} data-metric="network">
          <h2>
            <Network size={16} strokeWidth={1.75} />
            网络速度
          </h2>
          <div className={styles.speeds}>
            <span>
              <strong>
                <i className={styles.down} aria-hidden>
                  ↓
                </i>
                {bytes(s.network.receiveRate)}
              </strong>
              <small>/s 接收</small>
            </span>
            <span>
              <strong>
                <i className={styles.up} aria-hidden>
                  ↑
                </i>
                {bytes(s.network.sendRate)}
              </strong>
              <small>/s 发送</small>
            </span>
          </div>
          <p>当前物理网卡合计速度</p>
        </section>
        <section className={styles.card} data-metric="power">
          <h2>
            <PlugZap size={16} strokeWidth={1.75} />
            供电与运行时间
          </h2>
          <strong>
            {s.power.source === 'AC Power' ? '外接电源' : s.power.source === 'Battery Power' ? '电池供电' : s.power.source}
            {s.power.battery !== null && <small> · {s.power.battery}%</small>}
          </strong>
          <p>
            连续运行 {Math.floor(uptime / 86400)} 天 {Math.floor((uptime % 86400) / 3600)} 小时 {Math.floor((uptime % 3600) / 60)} 分钟
          </p>
        </section>
      </div>
      <section className={styles.section}>
        <h2>
          <HardDrive size={14} strokeWidth={2} />
          存储
        </h2>
        <div className={styles.group}>
          {s.volumes.length ? (
            s.volumes.map((volume) => {
              const startup = volume.mount === '/' || volume.mount === '/System/Volumes/Data'
              const name = startup ? '启动磁盘' : volume.mount.split('/').pop()
              return (
                <article key={volume.mount} className={styles.volume}>
                  <header>
                    <strong>{name}</strong>
                    <span>
                      {bytes(volume.available)} 可用 / 共 {bytes(volume.total)}
                    </span>
                  </header>
                  <progress className={styles.meter} aria-label={`${name}使用量`} max={volume.total || 1} value={Math.max(0, volume.total - volume.available)} />
                  <p>已使用 {bytes(Math.max(0, volume.total - volume.available))}</p>
                </article>
              )
            })
          ) : (
            <p className={styles.groupNote}>暂时无法读取存储信息</p>
          )}
        </div>
      </section>
      <p className={styles.footer}>约每 5 秒自动更新。CPU 和网络速度需要相邻两次采样；无法读取的数据会显示为未知。</p>
    </div>
  )
}
