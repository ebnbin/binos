import type { DevicesSnapshot } from '@binos/server/apps/devices/api'
import type { LeaseResult, Platform } from '@binos/server/apps/devices/types'
import { errorMessage } from '../../api.ts'

const base = '/api/apps/devices'
async function request<T>(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<T> {
  const response = await fetch(`${base}${path}`, body === undefined ? { method } : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!response.ok) throw new Error(await errorMessage(response, '设备操作失败'))
  return (response.status === 204 ? undefined : await response.json()) as T
}
export const readDevices = () => request<DevicesSnapshot>('')
export const discoverDevices = () => request<DevicesSnapshot>('/discover', {})
export const acquireDevices = (platforms: Platform[], reason: string, requestId: string = crypto.randomUUID()) => request<LeaseResult>('/leases', { platforms, reason, requestId })
export const releaseDevices = (id: string) => request(`/leases/${encodeURIComponent(id)}`, undefined, 'DELETE')
export const cancelDevices = (requestId: string) => request(`/queue/${encodeURIComponent(requestId)}`, undefined, 'DELETE')
export const destroyDevice = (id: string) => request(`/${encodeURIComponent(id)}`, undefined, 'DELETE')
export const captureDevice = (id: string) => request<{ image: string; mime: string; at: number }>(`/${encodeURIComponent(id)}/screenshot`)
