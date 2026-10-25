import type { Context } from 'hono'

// WebSocket 不经过 CORS 预检，浏览器跨站发起的连接要在这里拒绝。浏览器发起 WebSocket 一定带 Origin；
// 不带的是原生客户端，和其他请求一样已经过身份校验
export function isCrossSite(c: Context) {
  const origin = c.req.header('origin')
  if (origin === undefined) return false
  try {
    const url = new URL(origin)
    return !['http:', 'https:'].includes(url.protocol) || url.host !== c.req.header('host')
  } catch {
    return true
  }
}
