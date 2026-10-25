import { Hono } from 'hono'
import { notifyChange } from '../../events.js'
import { readSession, sessionExists, sessionOf, sessionTitle } from '../code/sessions.js'
import { adminDeviceRequest, deviceRequest } from './client.js'
import { parseRequest } from './protocol.js'
import type { DeviceScreenshot, LeaseResult, Snapshot } from './types.js'

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
  .onError((error, c) => c.json({ error: error.message }, 409))
  .get('/', async (c) => c.json(await snapshot(false)))
  .post('/discover', async (c) => c.json(await snapshot(true)))
  .post('/leases', async (c) => {
    const body = await c.req.json() as Record<string, unknown>
    const request = parseRequest({ ...body, action: 'acquire', owner: 'manual' })
    const result = await deviceRequest<LeaseResult>(request)
    notifyChange({ type: 'devices' })
    return c.json(result)
  })
  .post('/leases/:id/release', async (c) => {
    const status = await deviceRequest<Snapshot>({ action: 'status' })
    const lease = status.leases.find((item) => item.id === c.req.param('id'))
    if (!lease) return c.json({ ok: true })
    if (lease.owner !== 'manual') return c.json({ error: '只能归还手动申请；回收其他会话请使用设备强制回收' }, 403)
    await deviceRequest({ action: 'release', lease: lease.id, owner: lease.owner })
    notifyChange({ type: 'devices' })
    return c.json({ ok: true })
  })
  .post('/queue/cancel', async (c) => {
    const body = await c.req.json() as { requestId: string }
    await deviceRequest(parseRequest({ action: 'cancel', owner: 'manual', requestId: body.requestId }))
    notifyChange({ type: 'devices' })
    return c.json({ ok: true })
  })
  .post('/:id/control', async (c) => {
    const body = await c.req.json() as Record<string, unknown>
    await adminDeviceRequest(parseRequest({ ...body, action: 'control', device: c.req.param('id') }))
    notifyChange({ type: 'devices' })
    return c.json({ ok: true })
  })
  .get('/:id/screenshot', async (c) => c.json(await adminDeviceRequest<DeviceScreenshot>({ action: 'screenshot', device: c.req.param('id') })))
export type DevicesApi = typeof devicesApi
