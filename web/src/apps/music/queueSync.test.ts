import { afterEach, expect, it, vi } from 'vitest'
import type { QueueMutation, QueueSnapshot, Track } from '../../contract.ts'
import { QueueSync } from './queueSync.ts'
const track = (id: string): Track => ({ ref: { provider: 'audio', id }, title: id, artists: [], externalUrl: `https://example.com/${id}` })
afterEach(() => vi.useRealTimers())
it('旧请求晚返回时不回退队列，保留待提交的添加', async () => {
  let finish!: (value: QueueSnapshot) => void
  const apply = vi.fn<(tracks: Track[]) => void>()
  const sync = new QueueSync({ read: async () => ({ revision: 3, tracks: [track('remote')] }), mutate: () => new Promise(resolve => { finish = resolve }) }, apply)
  sync.enqueue({ type: 'add', tracks: [track('local')] })
  await sync.refresh()
  expect(apply).toHaveBeenLastCalledWith([track('remote'), track('local')])
  finish({ revision: 2, tracks: [track('local')] })
  await Promise.resolve()
  expect(apply).toHaveBeenLastCalledWith([track('remote')])
  sync.close()
})
it('网络错误后重试同一操作，成功后恢复同步状态', async () => {
  vi.useFakeTimers()
  const mutate = vi.fn<(value: QueueMutation) => Promise<QueueSnapshot>>().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ revision: 1, tracks: [track('a')] })
  const apply = vi.fn<(tracks: Track[]) => void>()
  const sync = new QueueSync({ read: async () => ({ revision: 0, tracks: [] }), mutate }, apply)
  sync.enqueue({ type: 'add', tracks: [track('a')] })
  await Promise.resolve()
  expect(sync.getSnapshot()).toContain('重试')
  await vi.advanceTimersByTimeAsync(3000)
  expect(mutate.mock.calls[0][0]).toEqual(mutate.mock.calls[1][0])
  expect(apply).toHaveBeenLastCalledWith([track('a')])
  expect(sync.getSnapshot()).toBe('队列已在设备间同步')
  sync.close()
})
