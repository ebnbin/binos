import type { EnrollmentLink, IosDevices } from '@binos/server/apps/builds/types'
import { useCallback, useEffect, useRef, useState } from 'react'
import { errorMessage } from '../../api.ts'
import { onChange } from '../../events.ts'
import { CopyButton } from '../../ui/CopyButton.tsx'
import styles from './builds.module.css'
import { buildsBase as base } from './useBuilds.ts'

const registerUrl = 'https://developer.apple.com/account/resources/devices/add'

// 能无线安装 iOS 包的设备：设备在本机的 Ad Hoc 描述文件里才装得上。登记时设备通过 downloads.binos.app 发回 UDID，模拟构建的预览里不能登记
export function IosDevicesSection({ real, onError }: { real: boolean; onError: (message: string) => void }) {
  const [data, setData] = useState<IosDevices>()
  const [busy, setBusy] = useState(false)
  const latest = useRef(0)
  const load = useCallback(async () => {
    const version = ++latest.current
    try {
      const r = await fetch(`${base}/devices`)
      if (!r.ok) throw new Error(await errorMessage(r, '读取设备失败'))
      const result = (await r.json()) as IosDevices
      if (latest.current === version) setData(result)
    } catch (e) { if (latest.current === version) onError(String(e)) }
  }, [onError])
  // 设备登记后后端发 builds 通知；构建完成也会发，那时描述文件可能已经更新
  useEffect(() => {
    const initial = setTimeout(() => void load(), 0)
    const stop = onChange((event) => { if (event === null || event.type === 'builds') void load() })
    const visible = () => { if (!document.hidden) void load() }
    document.addEventListener('visibilitychange', visible)
    return () => { clearTimeout(initial); stop(); document.removeEventListener('visibilitychange', visible) }
  }, [load])
  async function act(operation: () => Promise<void>) {
    setBusy(true)
    try { await operation() } catch (e) { onError(String(e)) } finally { setBusy(false) }
  }
  const enroll = () => act(async () => {
    const r = await fetch(`${base}/devices/enrollment`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
    if (!r.ok) throw new Error(await errorMessage(r, '无法创建登记链接'))
    window.location.assign(((await r.json()) as EnrollmentLink).url)
  })
  const remove = (udid: string) => act(async () => {
    const r = await fetch(`${base}/devices/${encodeURIComponent(udid)}`, { method: 'DELETE' })
    if (!r.ok) throw new Error(await errorMessage(r, '移除失败'))
    await load()
  })
  return <section className={styles.section}>
    <h2 className={styles.groupHeader}>iOS 安装设备</h2>
    {data && (data.devices.length ? <div className={styles.list}>{data.devices.map((device) => <article className={styles.build} key={device.udid}>
      <div className={styles.buildTitle}><strong>{device.name ?? device.model}</strong><span className={styles.badge} data-status={device.provisioned ? 'success' : 'queued'}>{device.provisioned ? '可以安装' : '还不能安装'}</span></div>
      <small className={styles.meta}>{[device.name && device.model, device.version && `系统 ${device.version}`, `登记于 ${new Date(device.enrolledAt).toLocaleString()}`].filter(Boolean).join(' · ')}</small>
      <div className={styles.udid}><code>{device.udid}</code><CopyButton text={device.udid} label="复制 UDID" /></div>
      {!device.provisioned && <p className={styles.meta}>在 Apple 开发者网站登记这个 UDID，然后重新构建一次 iOS，新的安装包就能装到这台设备上。</p>}
      <div className={styles.actions}>
        {!device.provisioned && <a className={styles.tinted} href={registerUrl} target="_blank" rel="noreferrer">在开发者网站登记 ↗</a>}
        <button className={styles.button} disabled={busy} onClick={() => void remove(device.udid)}>从列表移除</button>
      </div>
    </article>)}</div> : <p className={styles.empty}>还没有登记设备。</p>)}
    {real && <div className={styles.actions}><button className={styles.prominent} disabled={busy} onClick={() => void enroll()}>登记这台设备</button></div>}
    <small className={styles.footer}>{real ? '在要安装的 iPhone 或 iPad 上点「登记这台设备」，允许下载描述文件后到「设置」里安装，设备会把 UDID 发回 binOS，系统里不会留下描述文件。' : '预览模式不能登记设备。'}{data?.profile ? `本机的 Ad Hoc 描述文件里有 ${data.profile.devices} 台设备，${new Date(data.profile.expiresAt).toLocaleDateString()} 到期。` : real && '本机还没有可用的 Ad Hoc 描述文件。'}在开发者网站登记设备后，下一次 iOS 构建会自动更新描述文件。</small>
  </section>
}
