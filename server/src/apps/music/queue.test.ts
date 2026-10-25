import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, expect, it } from 'vitest'
import type { Track } from './types.js'
const root = mkdtempSync(path.join(os.tmpdir(), 'binos-queue-'))
process.env.BINOS_ROOT = root
process.env.BINOS_TEST_INSTANCE = '1'
const { musicApi } = await import('./api.js')
const track = (id: string): Track => ({ ref: { provider: 'audio', id }, title: id, artists: [], externalUrl: `https://example.com/${id}` })
const mutate = (id: string, operation: unknown) => musicApi.request('/queue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, operation }) })
beforeEach(() => rmSync(path.join(root, 'Library', 'Apps', 'music'), { recursive: true, force: true }))
afterAll(() => rmSync(root, { recursive: true, force: true }))
it('多设备添加不覆盖，操作重试不重复执行，服务端数据持久化', async () => {
  await Promise.all([mutate('device-a', { type: 'add', tracks: [track('a')] }), mutate('device-b', { type: 'add', tracks: [track('b')] })])
  await mutate('clear', { type: 'clear' })
  await mutate('new', { type: 'add', tracks: [track('c')] })
  await mutate('clear', { type: 'clear' })
  expect(await (await musicApi.request('/queue')).json()).toEqual({ revision: 4, tracks: [track('c')] })
  const { readQueue } = await import('./queue.js')
  expect(readQueue().tracks).toEqual([track('c')])
})
it('旧浏览器只初始化一次，清空后的队列不会被其他设备缓存复活', async () => {
  await mutate('first', { type: 'initialize', tracks: [track('a')] })
  await mutate('clear', { type: 'clear' })
  await mutate('second', { type: 'initialize', tracks: [track('b')] })
  expect(await (await musicApi.request('/queue')).json()).toMatchObject({ tracks: [] })
})
it('拒绝无效队列数据，按 provider 和 id 删除', async () => {
  expect((await mutate('bad', { type: 'add', tracks: [{ title: 'bad' }] })).status).toBe(400)
  expect((await mutate('bad', { type: 'unknown' })).status).toBe(400)
  await mutate('add', { type: 'add', tracks: [track('a'), { ...track('a'), ref: { provider: 'other', id: 'a' } }] })
  const response = await mutate('remove', { type: 'remove', ref: track('a').ref })
  expect(await response.json()).toMatchObject({ tracks: [{ ref: { provider: 'other', id: 'a' } }] })
})
it('按 provider 和 id 调整顺序，超出范围的放到两头', async () => {
  await mutate('add', { type: 'add', tracks: [track('a'), track('b'), track('c')] })
  const ids = async (id: string, operation: unknown) => ((await (await mutate(id, operation)).json()) as { tracks: Track[] }).tracks.map((item) => item.ref.id)
  expect(await ids('move-1', { type: 'move', ref: track('c').ref, index: 0 })).toEqual(['c', 'a', 'b'])
  expect(await ids('move-2', { type: 'move', ref: track('c').ref, index: 99 })).toEqual(['a', 'b', 'c'])
  expect((await mutate('move-3', { type: 'move', ref: track('a').ref, index: 1.5 })).status).toBe(400)
})
