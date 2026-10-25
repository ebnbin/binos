import { createReadStream, statSync } from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import type { Context } from 'hono'

// 本机文件可能包含可执行内容，只有这些在页面里直接打开，其余一律下载：HTML、SVG 之类在这个域名下打开的话，里面的脚本就能以你的身份操作
const inlineTypes: Record<string, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  avif: 'image/avif',
  bmp: 'image/bmp',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  pdf: 'application/pdf',
  txt: 'text/plain; charset=utf-8',
  md: 'text/plain; charset=utf-8',
  log: 'text/plain; charset=utf-8',
  csv: 'text/plain; charset=utf-8',
  json: 'text/plain; charset=utf-8',
}

// 带 ?info=1 时返回的文件信息
export type FileInfo = { size: number; modified: string; type: string }

export function serveFile(c: Context, filePath: string, immutable = false) {
  const inline = inlineTypes[path.extname(filePath).slice(1).toLowerCase()]
  const name = c.req.query('name')
  const disposition = (inline && !name ? 'inline' : 'attachment') + (name ? `; filename*=UTF-8''${encodeURIComponent(name)}` : '')
  const info = statSync(filePath)
  if (!info.isFile()) return c.text('Not Found', 404)
  if (c.req.query('info') === '1') {
    return c.json({ size: info.size, modified: info.mtime.toISOString(), type: inline || 'application/octet-stream' } satisfies FileInfo)
  }
  const headers = {
    'Content-Type': inline || 'application/octet-stream',
    'Content-Disposition': disposition,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': immutable ? 'private, max-age=31536000, immutable' : 'no-store',
    'Accept-Ranges': 'bytes',
  }
  const range = c.req.header('Range')
  let start = 0
  let end = info.size - 1
  if (range) {
    const parsed = /^bytes=(\d*)-(\d*)$/.exec(range)
    if (!parsed || (!parsed[1] && !parsed[2])) {
      return c.body(null, 416, { 'Content-Range': `bytes */${info.size}` })
    }
    start = parsed[1] ? Number(parsed[1]) : Math.max(0, info.size - Number(parsed[2]))
    end = parsed[1] && parsed[2] ? Math.min(Number(parsed[2]), end) : end
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= info.size) {
      return c.body(null, 416, { 'Content-Range': `bytes */${info.size}` })
    }
  }
  if (info.size === 0) {
    return c.body(null, 200, { ...headers, 'Content-Length': '0' })
  }
  const body = Readable.toWeb(createReadStream(filePath, { start, end })) as ReadableStream<Uint8Array>
  return c.body(body, range ? 206 : 200, {
    ...headers,
    'Content-Length': String(end - start + 1),
    ...(range ? { 'Content-Range': `bytes ${start}-${end}/${info.size}` } : {}),
  })
}
