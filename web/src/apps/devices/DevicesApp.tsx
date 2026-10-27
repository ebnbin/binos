import { ArrowSquareOutIcon, ArrowsClockwiseIcon, CameraIcon, DeviceMobileIcon, TrashIcon } from '@phosphor-icons/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { DevicesSnapshot } from '@binos/server/apps/devices/api'
import type { Device, DeviceModel, Platform } from '@binos/server/apps/devices/types'
import type { WindowContext } from '../types.ts'
import { onChange } from '../../events.ts'
import { acquireDevices, cancelDevices, captureDevice, destroyDevice, discoverDevices, readDevices, readDisplays, readModels, releaseDevices } from './api.ts'
import { Select } from '../../ui/Select.tsx'
import styles from './DevicesApp.module.css'

const labels = { creating: '初始化中', checking: '检查中', free: '闲置', reserved: '整组预留', leased: '使用中', cleaning: '清理中', destroying: '回收中', broken: '故障隔离' }
const ownerName = (owner: string) => owner === 'manual' ? '手动使用' : owner
const moment = (time: number) => new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
export function DevicesApp({ ctx }: { ctx: WindowContext }) {
  const [data, setData] = useState<DevicesSnapshot>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [platform, setPlatform] = useState('both')
  const [models, setModels] = useState<DeviceModel[]>([])
  const [iosModel, setIosModel] = useState('')
  const [reason, setReason] = useState('手动验证')
  const latest = useRef(0)
  const { setTitle } = ctx
  useEffect(() => setTitle('设备'), [setTitle])
  useEffect(() => { void readModels().then(setModels).catch(() => {}) }, [])
  const load = useCallback(async () => {
    const version = ++latest.current
    try { const result = await readDevices(); if (latest.current === version) { setData(result); setError('') } }
    catch (error) { if (latest.current === version) setError(error instanceof Error ? error.message : '读取失败') }
  }, [])
  useEffect(() => {
    // 设备、租约、排队和操作记录变了后端发 devices 通知；重新连上时也重读
    const initial = setTimeout(() => void load(), 0)
    const stop = onChange((event) => { if (event === null || event.type === 'devices') void load() })
    return () => { clearTimeout(initial); stop() }
  }, [load])
  async function act(operation: () => Promise<unknown>) {
    setBusy(true)
    setError('')
    try { await operation(); await load() }
    catch (error) { setError(error instanceof Error ? error.message : '操作失败') }
    finally { setBusy(false) }
  }
  const own = data?.leases.find((lease) => lease.owner === 'manual')
  const waiting = data?.queue.some((item) => item.owner === 'manual')
  const manualRequest = data?.queue.find((item) => item.owner === 'manual')
  const pendingRequest = (manualRequest?.phase === 'failed' ? undefined : manualRequest) ?? (own && !own.claimed ? own : undefined)
  const pendingPlatforms = pendingRequest?.platforms.join(',')
  const pendingReason = pendingRequest?.reason
  const pendingModels = pendingRequest?.models && JSON.stringify(pendingRequest.models)
  const pendingId = manualRequest?.id ?? own?.requestId
  const pendingLease = own && !own.claimed ? own.id : undefined
  useEffect(() => {
    if (!pendingPlatforms) return
    const refresh = () => {
      void acquireDevices(pendingPlatforms.split(',') as Platform[], pendingReason ?? '', pendingModels && JSON.parse(pendingModels), pendingId).then(load).catch(() => {})
    }
    const initial = setTimeout(refresh, 0)
    const timer = setInterval(refresh, 30_000)
    return () => { clearTimeout(initial); clearInterval(timer) }
  }, [pendingPlatforms, pendingReason, pendingModels, pendingLease, pendingId, load])

  return (
    <div className={styles.app}>
      <div className={styles.content}>
      <header className={styles.header}>
        <div><h1>Devices <span>设备</span></h1><p>开发测试设备与会话调度</p></div>
        <button className={styles.icon} aria-label="刷新设备" title="刷新设备" disabled={busy} onClick={() => void act(load)}><ArrowsClockwiseIcon size={16} /></button>
      </header>
      {data?.mode === 'mock' && <p className={styles.notice}>模拟设备预览 · 所有操作与正式设备隔离</p>}
      {error && <p className={styles.alert} role="alert">{error}</p>}
      {!data ? <p className={styles.empty}>{error ? '设备服务暂时不可用' : '正在连接设备管理服务…'}</p> : <>
        <section className={styles.summary}>
          <div><strong>{data.devices.filter((device) => device.status === 'free').length}</strong><span>闲置设备</span></div>
          <div><strong>{data.leases.length}</strong><span>使用会话</span></div>
          <div><strong>{data.queue.filter(item => item.phase !== 'failed').length}</strong><span>排队会话</span></div>
        </section>
        <h2 className={styles.groupHeader}>申请设备</h2>
        <form className={styles.acquire} onSubmit={(event) => { event.preventDefault(); void act(() => acquireDevices(platform === 'both' ? ['android', 'ios'] : [platform as Platform], reason, platform !== 'android' && iosModel ? { ios: iosModel } : undefined)) }}>
          <Select label="申请平台" value={platform} onValueChange={setPlatform} disabled={busy || Boolean(own) || waiting} options={[{ value: 'both', label: 'Android + iOS' }, { value: 'android', label: 'Android' }, { value: 'ios', label: 'iOS' }]} />
          {platform !== 'android' && models.length > 0 && <Select label="iOS 机型" value={iosModel} onValueChange={setIosModel} disabled={busy || Boolean(own) || waiting} options={[{ value: '', label: `默认（${models.find((model) => model.default)?.name ?? '自动'}）` }, ...models.map((model) => ({ value: model.id, label: model.name }))]} />}
          <input className={styles.field} aria-label="使用用途" value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} placeholder="使用用途" disabled={busy || Boolean(own) || waiting} />
          {own ? <button type="button" className={styles.button} disabled={busy} onClick={() => void act(() => releaseDevices(own.id))}>归还我的设备</button> : waiting ? <button type="button" className={styles.button} disabled={busy} onClick={() => void act(() => cancelDevices(manualRequest!.id))}>取消申请</button> : <button type="submit" className={styles.prominent} disabled={busy}>申请设备</button>}
        </form>
        <p className={styles.footer}>设备池 {data.devices.length} / {data.capacity} · 按需创建 · 闲置一小时后销毁 · 双端全部就绪后交付</p>
        {own && <p className={styles.footer}>手动租约空闲 15 分钟后回收。查看截图不会延长占用。</p>}
        {data.devices.length === 0 && <p className={styles.empty}>设备池为空，申请时会自动创建专属设备。</p>}
        <div className={styles.grid}>
          {data.devices.map((device) => <DeviceCard key={`${device.id}-${device.status}-${data.leases.find((item) => item.devices.includes(device.id))?.id ?? ''}`} device={device} data={data} ctx={ctx} busy={busy} act={act} />)}
        </div>
        <section className={styles.section}>
          <h2 className={styles.groupHeader}>排队</h2>
          {data.queue.length ? <ol className={styles.group}>{data.queue.map((item) => <li className={styles.stacked} key={item.owner}><strong>{data.owners[item.owner]?.title || ownerName(item.owner)}</strong><span>{item.platforms.join(' + ')} · {item.phase === 'preparing' ? '正在准备整组设备' : item.phase === 'failed' ? item.error : '等待容量'} · {item.reason || '未填写用途'}</span></li>)}</ol> : <p className={styles.placeholderRow}>没有等待中的申请</p>}
        </section>
        <section className={styles.section}>
          <div className={styles.sectionTitle}><h2 className={styles.groupHeader}>已有模拟器</h2><button className={styles.borderless} disabled={busy} onClick={() => void act(async () => { const result = await discoverDevices(); setData(result) })}><ArrowSquareOutIcon size={14} />只读发现</button></div>
          {data.observed.length > 0 && <div className={styles.group}>{data.observed.map((item) => <div className={styles.observed} key={`${item.platform}-${item.target}`}><span>{item.name}</span><span>{item.platform} · {item.state}</span></div>)}</div>}
          <p className={styles.footer}>这些设备不参与分配，也不会被清理或接管。</p>
          {data.discoveryErrors.map((text) => <p className={styles.error} key={text}>{text}</p>)}
        </section>
        <section className={styles.section}>
          <h2 className={styles.groupHeader}>操作记录</h2>
          <ul className={styles.events}>{[...data.events].reverse().slice(0, 30).map((item, index) => <li key={`${item.time}-${index}`}><time>{moment(item.time)}</time><span>{item.text}{item.owner && <small>{data.owners[item.owner]?.title || ownerName(item.owner)}</small>}</span></li>)}</ul>
        </section>
        <footer className={styles.footer}>独立设备管理服务 · 启动于 {moment(data.startedAt)}</footer>
      </>}
      </div>
    </div>
  )
}
function DeviceCard({ device, data, ctx, busy, act }: { device: Device; data: DevicesSnapshot; ctx: WindowContext; busy: boolean; act: (operation: () => Promise<unknown>) => Promise<void> }) {
  const [confirmDestroy, setConfirmDestroy] = useState(false)
  // 每块屏幕一张截图，没有登记屏幕的设备只有一张
  const [captures, setCaptures] = useState<{ name?: string; url: string; at: number }[]>()
  useEffect(() => () => captures?.forEach((capture) => URL.revokeObjectURL(capture.url)), [captures])
  const lease = data.leases.find((item) => item.devices.includes(device.id))
  const session = lease && data.owners[lease.owner]
  return (
    <article className={styles.card}>
      <div className={styles.cardTitle}><span className={styles.cardIcon}><DeviceMobileIcon size={18} /></span><div><h2>{device.platform === 'ios' ? 'iOS' : 'Android'} · {device.id.slice(-8)}</h2><p>{[device.modelName, device.system?.replace('com.apple.CoreSimulator.SimRuntime.', '').replaceAll('-', '.') ?? (device.platform === 'ios' ? 'iOS' : 'Android')].filter(Boolean).join(' · ')}</p></div><span className={styles.badge} data-status={device.status}>{labels[device.status]}</span></div>
      {captures ? <div className={styles.screenshots}>{captures.map((capture) => <figure key={capture.url}><img className={styles.screenshot} src={capture.url} alt={`${device.name} ${capture.name ?? ''}屏幕截图`} />{capture.name && <figcaption className={styles.caption}>{capture.name}</figcaption>}</figure>)}</div> : <div className={styles.placeholder}><DeviceMobileIcon size={40} weight="light" /><span>按需查看设备画面</span></div>}
      {captures && <p className={styles.caption}>截图于 {moment(captures[0].at)} · 非实时画面</p>}
      <dl className={styles.details}><div><dt>设备</dt><dd>{device.id}</dd></div><div><dt>占用</dt><dd>{session && ctx.openApplication ? <button className={styles.link} onClick={() => ctx.openApplication?.('code', `/${session.session}`)}>{session.title || `会话 ${session.session}`}</button> : lease ? ownerName(lease.owner) : '无'}</dd></div>{lease && <><div><dt>用途</dt><dd>{lease.reason || '未填写'}</dd></div><div><dt>开始</dt><dd>{moment(lease.createdAt)}</dd></div></>}</dl>
      {device.error && <p className={styles.error}>{device.error}</p>}
      <div className={styles.actions}>
        <button className={styles.button} disabled={busy || !['free', 'reserved', 'leased'].includes(device.status) || Boolean(device.error)} onClick={() => void act(async () => {
          // 多屏设备每块屏幕各截一张，标出正在显示内容的屏幕
          const displays = (device.displays?.length ?? 0) > 1 ? await readDisplays(device.id) : [undefined]
          setCaptures(await Promise.all(displays.map(async (display) => ({ ...(display && { name: `${display.name} · ${display.width}×${display.height}${display.active ? ' · 正在显示' : ''}` }), ...await captureDevice(device.id, display?.id) }))))
        })}><CameraIcon size={14} />截图</button>
        {device.status !== 'destroying' && <button className={styles.destructive} disabled={busy} onClick={() => {
          if (!confirmDestroy) { setConfirmDestroy(true); return }
          void act(() => destroyDevice(device.id))
        }}><TrashIcon size={14} />{confirmDestroy ? lease ? '确认中断租约并销毁' : '确认销毁设备' : lease ? '强制回收' : '销毁设备'}</button>}
        {confirmDestroy && <button className={styles.button} disabled={busy} onClick={() => setConfirmDestroy(false)}>取消</button>}
      </div>
    </article>
  )
}
