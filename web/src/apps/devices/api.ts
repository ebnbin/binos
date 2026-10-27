import type { DevicesSnapshot } from '@binos/server/apps/devices/api'
import type { DeviceModel, LeaseResult, Models, Platform } from '@binos/server/apps/devices/types'
import { errorMessage } from '../../api.ts'

const base = '/api/apps/devices'
async function request<T>(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<T> {
  const response = await fetch(`${base}${path}`, body === undefined ? { method } : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!response.ok) throw new Error(await errorMessage(response, '设备操作失败'))
  return (response.status === 204 ? undefined : await response.json()) as T
}
export const readDevices = () => request<DevicesSnapshot>('')
export const discoverDevices = () => request<DevicesSnapshot>('/discover', {})
export const readModels = () => request<DeviceModel[]>('/models')
export const acquireDevices = (platforms: Platform[], reason: string, models?: Models, requestId: string = crypto.randomUUID()) => request<LeaseResult>('/leases', { platforms, reason, models, requestId })
export const releaseDevices = (id: string) => request(`/leases/${encodeURIComponent(id)}`, undefined, 'DELETE')
export const cancelDevices = (requestId: string) => request(`/queue/${encodeURIComponent(requestId)}`, undefined, 'DELETE')
export const destroyDevice = (id: string) => request(`/${encodeURIComponent(id)}`, undefined, 'DELETE')
// 截图的地址（页面不用时要 revoke）和截图的时间
export async function captureDevice(id: string): Promise<{ url: string; at: number }> {
  const response = await fetch(`${base}/${encodeURIComponent(id)}/screenshot`)
  if (!response.ok) throw new Error(await errorMessage(response, '截图失败'))
  return { url: URL.createObjectURL(await response.blob()), at: Date.parse(response.headers.get('Last-Modified') ?? '') || Date.now() }
}
