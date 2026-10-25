import { Hono } from 'hono'
import { badRequest, errorHandler, forbidden } from '../../errors.js'
import { notifyChange } from '../../events.js'
import { readSession, sessionExists, sessionOf, sessionTitle } from '../code/sessions.js'
import { adminDeviceRequest, deviceRequest } from './client.js'
import { parseRequest } from './protocol.js'
import type { DeviceScreenshot, LeaseResult, Snapshot } from './types.js'

function valid(value: Record<string, unknown>) {
  try {
    return parseRequest(value)
  } catch (error) {
    throw badRequest((error as Error).message)
  }
}

let last: string | undefined
export type DevicesSnapshot = Snapshot & { owners: Record<string, { session: number; title: string }> }
async function snapshot(discovery: boolean): Promise<DevicesSnapshot> {
  const status = await deviceRequest<Snapshot>({ action: discovery ? 'discover' : 'status' })
  const owners: DevicesSnapshot['owners'] = {}
  for (const item of [...status.leases, ...status.queue]) {
    const session = sessionOf(item.owner)
    if (session !== undefined && sessionExists(session)) owners[item.owner] = { session, title: sessionTitle(readSession(session)) }
  }
  const fingerprint = JSON.stringify([status.devices, status.leases, status.queue, status.events])
  if (last !== undefined && last !== fingerprint) notifyChange({ type: 'devices' })
  last = fingerprint
  return { ...status, owners }
}
export const devicesApi = new Hono()
  .use('*', async (c, next) => { c.header('Cache-Control', 'no-store'); await next() })
  // 设备服务回复的错误是给用户看的原因
  .onError(errorHandler([409, 'conflict']))
  .get('/', async (c) => c.json(await snapshot(false)))
  .post('/discover', async (c) => c.json(await snapshot(true)))
  .post('/leases', async (c) => {
    const body = await c.req.json() as Record<string, unknown>
    const request = valid({ ...body, action: 'acquire', owner: 'manual' })
    const result = await deviceRequest<LeaseResult>(request)
    notifyChange({ type: 'devices' })
    return c.json(result)
  })
  // 归还手动申请的设备；已经归还过的照样成功
  .delete('/leases/:id', async (c) => {
    const status = await deviceRequest<Snapshot>({ action: 'status' })
    const lease = status.leases.find((item) => item.id === c.req.param('id'))
    if (lease) {
      if (lease.owner !== 'manual') throw forbidden('只能归还手动申请；回收其他会话请使用设备强制回收')
      await deviceRequest({ action: 'release', lease: lease.id, owner: lease.owner })
      notifyChange({ type: 'devices' })
    }
    return c.body(null, 204)
  })
  // 取消排着队的手动申请
  .delete('/queue/:requestId', async (c) => {
    await deviceRequest(valid({ action: 'cancel', owner: 'manual', requestId: c.req.param('requestId') }))
    notifyChange({ type: 'devices' })
    return c.body(null, 204)
  })
  // 销毁设备，有租约时先强制回收
  .delete('/:id', async (c) => {
    await adminDeviceRequest(valid({ action: 'control', device: c.req.param('id'), operation: 'destroy' }))
    notifyChange({ type: 'devices' })
    return c.body(null, 204)
  })
  .get('/:id/screenshot', async (c) => c.json(await adminDeviceRequest<DeviceScreenshot>({ action: 'screenshot', device: c.req.param('id') })))
export type DevicesApi = typeof devicesApi
