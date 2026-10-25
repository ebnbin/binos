import { existsSync } from 'node:fs'
import { open, stat } from 'node:fs/promises'
import path from 'node:path'
import type { SSEStreamingApi } from 'hono/streaming'
import { connectedPreamble } from '../../sse.js'
import { buildRequest } from './client.js'
import { resultsDir } from './config.js'
import type { BuildLogMessage } from './types.js'

// 第一次连接时只从末尾这么多字节读起，长构建日志不会一次发太多
const initialTail = 512 * 1024
const chunkSize = 64 * 1024
const pollInterval = 1000
// 结果文件没写出来时（排队时被取消），隔这么多次去构建服务问一次是不是已经结束了
const statusEvery = 5
const pingEvery = 15

const isContinuation = (byte: number) => (byte & 0xc0) === 0x80

// 不在一个字的中间切开：buffer 末尾不完整的字留到下一次
export function completeLength(buffer: Buffer): number {
  let lead = buffer.length - 1
  while (lead >= 0 && buffer.length - lead < 4 && isContinuation(buffer[lead])) lead--
  if (lead < 0) return buffer.length
  const byte = buffer[lead]
  const size = byte >= 0xf0 ? 4 : byte >= 0xe0 ? 3 : byte >= 0xc0 ? 2 : 1
  return buffer.length - lead >= size ? buffer.length : lead
}

async function finished(id: string): Promise<boolean> {
  if (existsSync(path.join(resultsDir, id, 'result.json'))) return true
  const build = (await buildRequest({ action: 'status' })).builds.find((b) => b.id === id)
  return !build || (build.status !== 'queued' && build.status !== 'running')
}

// 按字节偏移续读构建日志：SSE 的 id 是读到的位置，断线重连时带上 Last-Event-ID（或 ?from=）接着读。读完、构建也结束了就发 end
export async function streamBuildLog(stream: SSEStreamingApi, id: string, from: number | undefined) {
  const file = path.join(resultsDir, id, 'build.log')
  let offset = from
  await stream.write(connectedPreamble)
  for (let tick = 0; !stream.aborted; tick++) {
    const size = (await stat(file).catch(() => undefined))?.size ?? 0
    const start = offset === undefined
    offset ??= Math.max(0, size - initialTail)
    const done = size <= offset && (existsSync(path.join(resultsDir, id, 'result.json')) || (tick % statusEvery === 0 && (await finished(id))))
    if (size > offset) {
      const handle = await open(file, 'r')
      try {
        while (offset < size && !stream.aborted) {
          const buffer = Buffer.alloc(Math.min(chunkSize, size - offset))
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset)
          let chunk = buffer.subarray(0, bytesRead)
          // 从末尾读起时可能落在一个字的中间
          let skip = 0
          if (start && offset > 0) while (skip < chunk.length && isContinuation(chunk[skip])) skip++
          chunk = chunk.subarray(skip, skip + completeLength(chunk.subarray(skip)))
          if (!chunk.length) break
          const message: BuildLogMessage = { type: 'log', offset: offset + skip, text: chunk.toString('utf8') }
          offset += skip + chunk.length
          await stream.writeSSE({ data: JSON.stringify(message), id: String(offset) })
        }
      } finally {
        await handle.close()
      }
    } else if (done) {
      await stream.writeSSE({ data: JSON.stringify({ type: 'end' } satisfies BuildLogMessage) })
      return
    }
    if (tick % pingEvery === pingEvery - 1) await stream.writeSSE({ event: 'ping', data: '' })
    await stream.sleep(pollInterval)
  }
}
