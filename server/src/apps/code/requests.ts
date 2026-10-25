// 发消息的请求可能到了、回应却丢了，页面会带着同一个 requestId 重试：同一个 requestId 只发一次，重试拿到第一次的结果
const keep = 10 * 60 * 1000
const results = new Map<string, { at: number; result: Promise<unknown> }>()

export function once<T>(requestId: string | undefined, run: () => Promise<T>): Promise<T> {
  if (requestId === undefined) return run()
  const now = Date.now()
  for (const [id, entry] of results) {
    if (now - entry.at > keep) results.delete(id)
  }
  const existing = results.get(requestId)
  if (existing) return existing.result as Promise<T>
  const result = run()
  results.set(requestId, { at: now, result })
  // 出了异常（没有结果）时允许重试
  result.catch(() => results.delete(requestId))
  return result
}
