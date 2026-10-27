import { describe, expect, it } from 'vitest'
import { emptyState } from './types.js'
import type { Device, Platform, State } from './types.js'
import { cancel, policy, release, requestLease, requireLease, schedule } from './state.js'

function device(id: string, platform: Platform, status: Device['status'] = 'free'): Device {
  return { id, platform, name: `binos-${id}`, target: id, status, idleSince: 0 }
}
function ready(state: State) {
  for (const item of state.devices) if (item.status === 'creating' || item.status === 'checking') item.status = 'reserved'
}
function request(state: State, owner: string, platforms: Platform[], now = 0) {
  requestLease(state, owner, '', platforms, now)
  schedule(state, now)
}
function invariants(state: State) {
  expect(state.devices.length).toBeLessThanOrEqual(policy.capacity)
  const assigned = [...state.leases, ...state.queue].flatMap((item) => item.devices)
  expect(new Set(assigned).size).toBe(assigned.length)
  const owners = [...state.leases, ...state.queue].map((item) => item.owner)
  expect(new Set(owners).size).toBe(owners.length)
  for (const lease of state.leases) {
    expect(lease.devices).toHaveLength(lease.platforms.length)
    expect(lease.devices.map((id) => state.devices.find((d) => d.id === id)!.platform).sort()).toEqual([...lease.platforms].sort())
  }
}
describe('动态设备池', () => {
  it('空池两份双端申请预占四台容量，全部就绪后各整组交付；后续请求排队', () => {
    const state = emptyState()
    request(state, 'a', ['android', 'ios'])
    request(state, 'b', ['android', 'ios'])
    request(state, 'c', ['ios'])
    expect(state.devices).toHaveLength(4)
    expect(state.leases).toHaveLength(0)
    state.devices[0].status = 'reserved'
    schedule(state, 1)
    expect(state.leases).toHaveLength(0)
    ready(state)
    schedule(state, 2)
    expect(state.leases.map((l) => l.owner)).toEqual(['a', 'b'])
    expect(state.queue.map((q) => q.owner)).toEqual(['c'])
    invariants(state)
  })
  it('AAaI 申请 iOS 销毁闲置 Android，销毁完成前不释放容量', () => {
    const state = emptyState()
    state.devices = [device('a1', 'android', 'leased'), device('a2', 'android', 'leased'), device('a3', 'android'), device('i1', 'ios', 'leased')]
    request(state, 'x', ['ios'])
    expect(state.devices[2].status).toBe('destroying')
    expect(state.devices).toHaveLength(4)
    expect(state.queue[0].phase).toBe('waiting')
    schedule(state, 1)
    expect(state.devices).toHaveLength(4)
    state.devices.splice(2, 1)
    schedule(state, 2)
    expect(state.devices.filter((d) => d.platform === 'ios')).toHaveLength(2)
    expect(state.queue[0].phase).toBe('preparing')
  })
  it('AAAi 直接检查并复用 iOS；同一会话不能升级或叠加申请', () => {
    const state = emptyState()
    state.devices = [device('a1', 'android', 'leased'), device('a2', 'android', 'leased'), device('a3', 'android', 'leased'), device('i1', 'ios')]
    request(state, 'x', ['ios'])
    expect(state.devices[3].status).toBe('checking')
    expect(state.devices).toHaveLength(4)
    expect(() => request(state, 'x', ['android', 'ios'])).toThrow('先归还')
    ready(state)
    schedule(state, 1)
    const id = state.leases[0].id
    request(state, 'x', ['ios'], 2)
    expect(state.leases[0].id).toBe(id)
  })
  it('取消创建、重复归还和旧申请重试不会影响新租约', () => {
    const state = emptyState()
    request(state, 'x', ['android', 'ios'])
    const old = state.queue[0]
    cancel(state, old, 1)
    expect(state.devices.every((d) => d.status === 'destroying')).toBe(true)
    expect(() => requestLease(state, 'x', '', ['android', 'ios'], 2, old.id)).toThrow('申请已结束')
    state.devices = []
    request(state, 'x', ['android'])
    ready(state)
    schedule(state, 3)
    const lease = state.leases[0]
    release(state, lease, 4, '归还')
    expect(() => requireLease(state, 'x', lease.id)).toThrow('已失效')
    expect(state.devices[0].status).toBe('cleaning')
    expect(state.devices[0].idleSince).toBe(4)
  })
  it('一端故障不交付，释放另一端；准备超时也不残留半份租约', () => {
    for (const timeout of [false, true]) {
      const state = emptyState()
      request(state, 'x', ['android', 'ios'])
      state.devices[0].status = 'reserved'
      state.devices[1].status = timeout ? 'creating' : 'broken'
      state.queue[0].lastSeen = policy.prepare + 1
      schedule(state, timeout ? policy.prepare + 1 : 1)
      expect(state.leases).toHaveLength(0)
      expect(state.queue[0].phase).toBe('failed')
      expect(state.devices[0].status).toBe('free')
      expect(state.queue[0].devices).toHaveLength(0)
    }
  })
  it('全局排队保护双端所需容量，不让后续单端抢走闲置设备', () => {
    const state = emptyState()
    state.devices = [device('a1', 'android', 'leased'), device('a2', 'android', 'leased'), device('a3', 'android', 'leased'), device('i1', 'ios')]
    request(state, 'first', ['android', 'ios'])
    request(state, 'later', ['ios'])
    expect(state.queue.every((q) => q.phase === 'waiting')).toBe(true)
    expect(state.devices[3].status).toBe('free')
    state.devices[0].status = 'free'
    schedule(state, 1)
    expect(state.queue[0].phase).toBe('preparing')
    expect(state.queue[1].phase).toBe('waiting')
  })
  it('设备闲置计时不受清理、状态读取影响；执行命令免于普通租约超时', () => {
    const state = emptyState()
    request(state, 'x', ['android'])
    ready(state)
    schedule(state, 1)
    state.leases[0].claimed = true
    const lease = state.leases[0]
    schedule(state, policy.idle + 2, new Set([lease.id]))
    expect(state.leases).toHaveLength(1)
    release(state, lease, policy.idle + 3, '归还')
    state.devices[0].status = 'free'
    schedule(state, policy.idle + policy.deviceIdle + 3)
    expect(state.devices[0].status).toBe('destroying')
  })
  it('指定机型只复用同一机型的闲置设备，没有时腾出容量按机型创建', () => {
    const state = emptyState()
    state.devices = [{ ...device('i1', 'ios'), model: 'phone' }, { ...device('i2', 'ios'), model: 'tablet' }, device('a1', 'android', 'leased'), device('a2', 'android', 'leased')]
    requestLease(state, 'x', '', ['ios'], 0, undefined, { ios: 'tablet' })
    schedule(state, 0)
    expect(state.queue[0].devices).toEqual(['i2'])
    requestLease(state, 'y', '', ['ios'], 0, undefined, { ios: 'fold' })
    schedule(state, 0)
    expect(state.devices.find((d) => d.id === 'i1')!.status).toBe('destroying')
    state.devices = state.devices.filter((d) => d.id !== 'i1')
    schedule(state, 1)
    expect(state.devices.find((d) => d.status === 'creating')?.model).toBe('fold')
    expect(() => requestLease(state, 'y', '', ['ios'], 2, undefined, { ios: 'phone' })).toThrow('不同机型')
    expect(() => requestLease(state, 'y', '', ['ios'], 2)).toThrow('不同机型')
    invariants(state)
  })
  it('未领取的整组与失联准备申请按时回收', () => {
    const state = emptyState()
    request(state, 'x', ['android', 'ios'])
    ready(state)
    schedule(state, 1)
    schedule(state, policy.queueIdle + 2)
    expect(state.leases).toHaveLength(0)
    expect(state.devices.every((d) => d.status === 'cleaning')).toBe(true)
    const other = emptyState()
    request(other, 'y', ['android', 'ios'])
    schedule(other, policy.queueIdle + 1)
    expect(other.queue).toHaveLength(0)
    expect(other.devices.every((d) => d.status === 'destroying')).toBe(true)
  })
  it('混合申请与回收交错时保持容量、独占和整组不变量', () => {
    const state = emptyState()
    let seed = 42
    const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed }
    for (let now = 0; now < 1000; now++) {
      const owner = `s${rand() % 12}`
      if (![...state.queue, ...state.leases].some((item) => item.owner === owner)) requestLease(state, owner, '', [['android'], ['ios'], ['android', 'ios']][rand() % 3] as Platform[], now)
      if (rand() % 3 === 0) ready(state)
      if (rand() % 4 === 0 && state.leases.length) release(state, state.leases[0], now, '归还')
      if (rand() % 5 === 0 && state.queue.length) cancel(state, state.queue[0], now)
      state.devices = state.devices.filter((d) => d.status !== 'destroying')
      for (const d of state.devices) if (d.status === 'cleaning') d.status = 'free'
      schedule(state, now)
      invariants(state)
    }
    expect(state.devices.length).toBeLessThanOrEqual(4)
  })
})
