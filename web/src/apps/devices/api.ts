import type { Models, Platform } from '../../contract.ts'
import { ensureOk, readJson, request } from '../../api.ts'

const failed = '设备操作失败'
export const readDevices = async () => readJson(await request('GET /api/apps/devices'), failed)
export const discoverDevices = async () => readJson(await request('POST /api/apps/devices/discover'), failed)
export const readModels = async () => readJson(await request('GET /api/apps/devices/models'), failed)
export const acquireDevices = async (platforms: Platform[], reason: string, models?: Models, requestId: string = crypto.randomUUID()) =>
  readJson(await request('POST /api/apps/devices/leases', { json: { platforms, reason, models, requestId } }), failed)
export const releaseDevices = async (id: string) => { await ensureOk(await request('DELETE /api/apps/devices/leases/:id', { params: { id } }), failed) }
export const cancelDevices = async (requestId: string) => { await ensureOk(await request('DELETE /api/apps/devices/queue/:requestId', { params: { requestId } }), failed) }
export const readDisplays = async (id: string) => readJson(await request('GET /api/apps/devices/:id/displays', { params: { id } }), failed)
export const destroyDevice = async (id: string) => { await ensureOk(await request('DELETE /api/apps/devices/:id', { params: { id } }), failed) }
// 截图的地址（页面不用时要 revoke）和截图的时间；display 是设备的哪块屏幕
export async function captureDevice(id: string, display?: string): Promise<{ url: string; at: number }> {
  const response = await ensureOk(await request('GET /api/apps/devices/:id/screenshot', { params: { id }, query: { display } }), '截图失败')
  return { url: URL.createObjectURL(await response.blob()), at: Date.parse(response.headers.get('Last-Modified') ?? '') || Date.now() }
}
