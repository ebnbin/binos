import { expect, it, vi } from 'vitest'
import type { SystemSnapshot } from './types.js'
import { snapshot } from '../../../test-fixtures/system.js'
const { collect } = vi.hoisted(() => ({ collect: vi.fn<() => Promise<SystemSnapshot>>() }))
vi.mock('./collect.js', () => ({
  Collector: class {
    collect = collect
  },
}))
const { Monitor } = await import('./monitor.js')
it('合并并发采集，失败时保留上次快照并显示读取失败，成功后清除错误', async () => {
  const monitor = new Monitor()
  const data = snapshot()
  collect.mockImplementationOnce(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10))
    return data
  })
  await Promise.all([monitor.refresh(), monitor.refresh()])
  expect(collect).toHaveBeenCalledTimes(1)
  expect(monitor.status().snapshot).toEqual(data)
  collect.mockRejectedValueOnce(new Error('timeout'))
  await monitor.refresh()
  expect(monitor.status().snapshot).toEqual(data)
  expect(monitor.status().collectionError).toBe('暂时无法更新宿主状态')
  collect.mockResolvedValueOnce({ ...data, at: data.at + 5000 })
  await monitor.refresh()
  expect(monitor.status().collectionError).toBeUndefined()
})
