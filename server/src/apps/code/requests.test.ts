import { describe, expect, it, vi } from 'vitest'
import { once } from './requests.js'

describe('once', () => {
  it('同一个 requestId 只执行一次，重试拿到同一个结果', async () => {
    const run = vi.fn<() => Promise<{ id: number }>>(async () => ({ id: 1 }))
    const [first, retry] = await Promise.all([once('a', run), once('a', run)])
    expect(await once('a', run)).toBe(first)
    expect(retry).toBe(first)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('出了异常后可以重试', async () => {
    const run = vi.fn<() => Promise<string>>().mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce('ok')
    await expect(once('b', run)).rejects.toThrow('x')
    expect(await once('b', run)).toBe('ok')
  })
})
