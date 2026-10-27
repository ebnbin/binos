import { randomUUID } from 'node:crypto'
import type { Device, Lease, Models, Platform, State, Waiting } from './types.js'

export const policy = { capacity: 4, idle: 15 * 60_000, deviceIdle: 60 * 60_000, maxHold: 60 * 60_000, queueIdle: 3 * 60_000, prepare: 15 * 60_000 }
export function event(state: State, text: string, now: number, device?: string, owner?: string) {
  state.events.push({ time: now, text, ...(device && { device }), ...(owner && { owner }) })
  state.events = state.events.slice(-200)
}
export function transition(device: Device, status: Device['status']) {
  device.status = status
  device.generation = randomUUID()
  device.attempts = 0
  delete device.retryAt
}
function end(state: State, id: string, owner: string, now: number) {
  state.ended.push({ id, owner, at: now })
}
export function release(state: State, lease: Lease, now: number, why: string) {
  for (const id of lease.devices) {
    const device = state.devices.find((item) => item.id === id)!
    transition(device, 'cleaning')
    device.idleSince = now
    delete device.error
  }
  state.leases = state.leases.filter((item) => item.id !== lease.id)
  end(state, lease.requestId, lease.owner, now)
  event(state, why, now, undefined, lease.owner)
}
export function cancel(state: State, waiting: Waiting, now: number) {
  for (const id of waiting.devices) {
    const device = state.devices.find((item) => item.id === id)
    if (!device) continue
    if (device.status === 'creating' || device.status === 'checking') transition(device, 'destroying')
    else if (device.status === 'reserved') { transition(device, 'free'); device.idleSince = now }
  }
  state.queue = state.queue.filter((item) => item.id !== waiting.id)
  end(state, waiting.id, waiting.owner, now)
}
export function fail(state: State, waiting: Waiting, now: number, error: string) {
  cancel(state, waiting, now)
  waiting.phase = 'failed'
  waiting.error = error
  waiting.devices = []
  state.queue.push(waiting)
  event(state, error, now, undefined, waiting.owner)
}
export function schedule(state: State, now: number, busy: ReadonlySet<string> = new Set()) {
  for (const waiting of [...state.queue]) {
    if (now - waiting.lastSeen > policy.queueIdle) { cancel(state, waiting, now); continue }
    if (waiting.phase !== 'preparing') continue
    const devices = waiting.devices.map((id) => state.devices.find((item) => item.id === id))
    const broken = devices.find((device) => !device || device.status === 'broken' || device.status === 'destroying')
    if (devices.some((device) => !device || device.status === 'broken' || device.status === 'destroying') || now - waiting.preparingAt! > policy.prepare) {
      fail(state, waiting, now, broken?.error ?? '设备准备失败或超时，请归还申请后重试')
    } else if (devices.every((device) => device!.status === 'reserved')) {
      state.leases.push({ requestId: waiting.id, id: randomUUID(), owner: waiting.owner, reason: waiting.reason, platforms: waiting.platforms, ...(waiting.models && { models: waiting.models }), devices: waiting.devices, createdAt: now, lastSeen: now })
      state.queue = state.queue.filter((item) => item.id !== waiting.id)
      event(state, '整组设备已就绪，等待领取', now, undefined, waiting.owner)
    }
  }
  for (const lease of [...state.leases]) {
    if (busy.has(lease.id)) continue
    if ((!lease.claimed && now - lease.createdAt > policy.queueIdle) || now - lease.lastSeen > policy.idle || (state.queue.some((item) => item.phase !== 'failed') && now - lease.createdAt > policy.maxHold)) release(state, lease, now, '占用超时，正在清理设备')
  }
  for (const waiting of state.queue.filter((item) => item.phase === 'waiting')) {
    const chosen: Device[] = []
    const missing: Platform[] = []
    const fits = (device: Device, platform: Platform) => device.platform === platform && (!waiting.models?.[platform] || device.model === waiting.models[platform])
    for (const platform of waiting.platforms) {
      const found = state.devices.filter((device) => fits(device, platform) && device.status === 'free' && !device.error && !chosen.includes(device)).sort((a, b) => (b.idleSince ?? 0) - (a.idleSince ?? 0))[0]
      if (found) chosen.push(found)
      else missing.push(platform)
    }
    if (missing.some((platform) => state.devices.some((device) => fits(device, platform) && device.status === 'cleaning'))) break
    const shortage = state.devices.length + missing.length - policy.capacity
    if (shortage > 0) {
      const victims = state.devices.filter((device) => device.status === 'free' && !chosen.includes(device)).sort((a, b) => (a.idleSince ?? 0) - (b.idleSince ?? 0))
      if (victims.length >= shortage) {
        victims.slice(0, shortage).forEach((device) => transition(device, 'destroying'))
      } else if (state.devices.some((device) => device.status === 'broken' && device.attempts! >= 3) && !state.devices.some((device) => ['leased', 'reserved', 'creating', 'checking', 'cleaning', 'destroying'].includes(device.status))) {
        fail(state, waiting, now, '设备销毁失败占用容量，请在设备页面重试回收')
        continue
      }
      break
    }
    for (const platform of missing) {
      const id = `${platform}-${randomUUID()}`
      let port = 5560
      while (state.devices.some((device) => device.target === `emulator-${port}`)) port += 2
      const model = waiting.models?.[platform]
      const device: Device = { id, platform, name: `binos-${id}`, target: platform === 'android' ? `emulator-${port}` : '', ...(model && { model }), status: 'creating', generation: randomUUID() }
      state.devices.push(device)
      chosen.push(device)
    }
    for (const device of chosen) if (device.status === 'free') transition(device, 'checking')
    waiting.devices = chosen.map((device) => device.id)
    waiting.phase = 'preparing'
    waiting.preparingAt = now
    event(state, '正在准备整组设备', now, undefined, waiting.owner)
  }
  for (const device of state.devices) if (device.status === 'free' && now - (device.idleSince ?? now) >= policy.deviceIdle) transition(device, 'destroying')
  state.ended = state.ended.filter((item) => now - item.at < 24 * 60 * 60_000)
}
const sameModels = (a: Models = {}, b: Models = {}) => a.android === b.android && a.ios === b.ios
export function requestLease(state: State, owner: string, reason: string, platforms: Platform[], now: number, requestId?: string, models?: Models) {
  if (requestId && [...state.queue, ...state.leases].some((item) => item.owner !== owner && ('requestId' in item ? item.requestId : item.id) === requestId)) throw new Error('申请编号已被使用')
  const existing = state.leases.find((item) => item.owner === owner) ?? state.queue.find((item) => item.owner === owner)
  if (requestId && state.ended.some((item) => item.id === requestId && item.owner === owner) && (!existing || existing.id !== requestId)) throw new Error('申请已结束，请重新申请')
  if (existing && [...existing.platforms].sort().join() !== [...platforms].sort().join()) throw new Error('已有不同平台的申请，请先归还或取消')
  if (existing && !sameModels(existing.models, models)) throw new Error('已有不同机型的申请，请先归还或取消')
  if (existing) existing.lastSeen = now
  else {
    state.queue.push({ id: requestId ?? randomUUID(), owner, reason, platforms, ...(models && { models }), devices: [], phase: 'waiting', createdAt: now, lastSeen: now })
    event(state, '申请设备', now, undefined, owner)
  }
}
export function requireLease(state: State, owner: string, id: string): Lease {
  const lease = state.leases.find((item) => item.id === id && item.owner === owner)
  if (!lease) throw new Error('设备租约已失效，请重新申请')
  return lease
}
