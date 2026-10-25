import { upgradeWebSocket } from '@hono/node-server'
import WebSocket from 'ws'
import { readFileSync } from 'node:fs'
import type { MiddlewareHandler } from 'hono'
import { except } from 'hono/combine'
import { proxy } from 'hono/proxy'
import { requireOwner } from './access.js'
import { isTestInstance, previewsDir } from './paths.js'
import { previewName, previewInfoPath } from './preview-info.js'
import type { PreviewInfo } from './preview-info.js'
import { isCrossSite } from './websocket-origin.js'

function previewPort(name: string): number | undefined {
  try {
    return (JSON.parse(readFileSync(previewInfoPath(previewsDir, name), 'utf8')) as PreviewInfo).port
  } catch {
    return undefined
  }
}

const forward: MiddlewareHandler = async (c, next) => {
  const name = previewName(c.req.url)!
  const port = previewPort(name)
  if (!port) {
    return c.text(`没有 ${name} 的预览`, 404)
  }
  const { pathname, search } = new URL(c.req.url)
  if (c.req.header('upgrade')?.toLowerCase() === 'websocket') {
    if (isCrossSite(c)) return c.text('Forbidden', 403)
    const origin = c.req.header('origin')
    return upgradeWebSocket(() => {
      let upstream: WebSocket | undefined
      const pending: string[] = []
      let pendingSize = 0
      return {
        onOpen(_event, downstream) {
          upstream = new WebSocket(`ws://127.0.0.1:${port}${pathname}${search}`, {
            headers: { ...(origin && { origin }), host: c.req.header('host')! },
            maxPayload: 128 * 1024,
            handshakeTimeout: 5000,
          })
          upstream.on('open', () => {
            for (const data of pending) upstream!.send(data)
            pending.length = 0
            pendingSize = 0
          })
          upstream.on('message', (data) => {
            if (((downstream.raw as WebSocket | undefined)?.bufferedAmount ?? 0) > 1024 * 1024) {
              upstream?.close()
              downstream.close()
              return
            }
            downstream.send(data.toString())
          })
          upstream.on('close', () => downstream.close())
          upstream.on('error', () => downstream.close())
        },
        onMessage(event, downstream) {
          if (typeof event.data !== 'string') return downstream.close(1003)
          if (upstream?.readyState === WebSocket.CONNECTING) {
            pendingSize += event.data.length
            if (pendingSize > 128 * 1024) return downstream.close(1009)
            pending.push(event.data)
            return
          }
          if (upstream?.readyState !== WebSocket.OPEN || upstream.bufferedAmount > 1024 * 1024) return downstream.close()
          upstream.send(event.data)
        },
        onClose() {
          upstream?.close()
        },
        onError() {
          upstream?.close()
        },
      }
    })(c, next)
  }
  let res: Response
  try {
    res = await proxy(`http://127.0.0.1:${port}${pathname}${search}`, c.req.raw)
  } catch {
    return c.text(`${name} 的预览没有在运行，在 PR 的 worktree 里运行 pnpm preview 重新启动`, 502)
  }
  return res.body ? new Response(endQuietlyOnAbort(res.body, c.req.raw.signal), res) : res
}

// 页面关闭时转发也随之中止，上游的读取会报错；这是正常结束，不当作错误写进日志。
// 预览实例中途断开时仍然报错，页面这一端随之断开，实时推送才会重连
function endQuietlyOnAbort(body: ReadableStream<Uint8Array>, signal: AbortSignal) {
  const reader = body.getReader()
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read()
        if (done) {
          controller.close()
        } else {
          controller.enqueue(value)
        }
      } catch (err) {
        if (signal.aborted) {
          controller.close()
        } else {
          controller.error(err)
        }
      }
    },
    cancel: (reason) => reader.cancel(reason),
  })
}

// pr-<编号> 子域名的请求先由正式版校验身份，再转给这个 PR 的预览实例；预览实例本身是测试实例，不再转发
export const previewProxy = except((c) => isTestInstance || !previewName(c.req.url), requireOwner, forward)
