import { Hono } from 'hono'
import { badRequest, errorHandler, forbidden } from '../../errors.js'
import { readSession, sessionExists, sessionOf, sessionTitle } from '../code/sessions.js'
import { adminDeviceRequest, deviceRequest } from './client.js'
import { parseRequest } from './protocol.js'
import type { DeviceModel, DeviceScreenshot, DisplayState, LeaseResult, Snapshot } from './types.js'

function valid(value: Record<string, unknown>) {
  try {
    return parseRequest(value)
  } catch (error) {
    throw badRequest((error as Error).message)
  }
}

export type DevicesSnapshot = Snapshot & { owners: Record<string, { session: number; title: string }> }
async function snapshot(discovery: boolean): Promise<DevicesSnapshot> {
  const status = await deviceRequest<Snapshot>({ action: discovery ? 'discover' : 'status' })
  const owners: DevicesSnapshot['owners'] = {}
  for (const item of [...status.leases, ...status.queue]) {
    const session = sessionOf(item.owner)
    if (session !== undefined && sessionExists(session)) owners[item.owner] = { session, title: sessionTitle(readSession(session)) }
  }
  return { ...status, owners }
}
export const devicesApi = new Hono()
  .use('*', async (c, next) => { c.header('Cache-Control', 'no-store'); await next() })
  // 设备服务回复的错误是给用户看的原因
  .onError(errorHandler([409, 'conflict']))
  .get('/', async (c) => c.json(await snapshot(false)))
  .post('/discover', async (c) => c.json(await snapshot(true)))
  .get('/models', async (c) => c.json(await deviceRequest<DeviceModel[]>({ action: 'models' })))
  .post('/leases', async (c) => {
    const body = await c.req.json() as Record<string, unknown>
    const request = valid({ ...body, action: 'acquire', owner: 'manual' })
    return c.json(await deviceRequest<LeaseResult>(request))
  })
  // 归还手动申请的设备；已经归还过的照样成功
  .delete('/leases/:id', async (c) => {
    const status = await deviceRequest<Snapshot>({ action: 'status' })
    const lease = status.leases.find((item) => item.id === c.req.param('id'))
    if (lease) {
      if (lease.owner !== 'manual') throw forbidden('只能归还手动申请；回收其他会话请使用设备强制回收')
      await deviceRequest({ action: 'release', lease: lease.id, owner: lease.owner })
    }
    return c.body(null, 204)
  })
  // 取消排着队的手动申请
  .delete('/queue/:requestId', async (c) => {
    await deviceRequest(valid({ action: 'cancel', owner: 'manual', requestId: c.req.param('requestId') }))
    return c.body(null, 204)
  })
  // 销毁设备，有租约时先强制回收
  .delete('/:id', async (c) => {
    await adminDeviceRequest(valid({ action: 'control', device: c.req.param('id'), operation: 'destroy' }))
    return c.body(null, 204)
  })
  // 图片本身，Last-Modified 是截图的时间
  .get('/:id/displays', async (c) => c.json(await adminDeviceRequest<DisplayState[]>({ action: 'displays', device: c.req.param('id') })))
  // ?display= 是设备的哪块屏幕，不填时截正在显示内容的屏幕
  .get('/:id/screenshot', async (c) => {
    const display = c.req.query('display')
    const { image, mime, at } = await adminDeviceRequest<DeviceScreenshot>({ action: 'screenshot', device: c.req.param('id'), ...(display && { display }) })
    return c.body(Buffer.from(image, 'base64'), 200, { 'Content-Type': mime, 'Last-Modified': new Date(at).toUTCString() })
  })
export type DevicesApi = typeof devicesApi
