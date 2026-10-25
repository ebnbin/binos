import { randomBytes } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream } from 'node:stream/web'
import { ApiException } from '../../errors.js'
import { dataDir } from './sessions.js'
import type { Upload } from './types.js'

// 用户上传的附件先放在 uploads/，随消息发出时交给 thread：新对话发出第一句之前还没有 thread

const uploadsDir = path.join(dataDir, 'uploads')

export const maxUploadBytes = 50 * 1024 * 1024
export const maxUploads = 20

// 随机串加原来的扩展名，既是 uploads/ 下的文件名，也是交给 thread 后的文件名
const filePattern = /^[0-9a-f]{32}(\.[a-z0-9]{1,10})?$/



// 超过上限时中途放弃，不等整个文件传完
export async function saveUpload(body: ReadableStream<Uint8Array>, name: string): Promise<string> {
  const extension = path.extname(name).slice(1).toLowerCase()
  const file = randomBytes(16).toString('hex') + (/^[a-z0-9]{1,10}$/.test(extension) ? `.${extension}` : '')
  mkdirSync(uploadsDir, { recursive: true })
  const filePath = path.join(uploadsDir, file)
  let size = 0
  try {
    await pipeline(
      Readable.fromWeb(body),
      async function* (source: AsyncIterable<Buffer>) {
        for await (const chunk of source) {
          size += chunk.length
          if (size > maxUploadBytes) {
            throw new ApiException(413, 'too-large', `附件不能超过 ${maxUploadBytes / 1024 / 1024} MB`)
          }
          yield chunk
        }
      },
      createWriteStream(filePath),
    )
  } catch (error) {
    rmSync(filePath, { force: true })
    throw error
  }
  return file
}

// 文件名会写进给 agent 的消息和下载时的文件名，去掉控制字符
export function parseUploads(input: unknown): Upload[] | undefined {
  if (input === undefined) {
    return []
  }
  if (!Array.isArray(input) || input.length > maxUploads) {
    return undefined
  }
  const uploads: Upload[] = []
  for (const item of input as { file?: unknown; name?: unknown }[]) {
    const { file, name } = item ?? {}
    if (typeof file !== 'string' || !filePattern.test(file) || typeof name !== 'string' || !existsSync(path.join(uploadsDir, file))) {
      return undefined
    }
    uploads.push({ file, name: name.replace(/\p{Cc}/gu, '').slice(0, 200) || file })
  }
  return uploads
}

// 交给 thread 的本机文件
export const uploadFiles = (uploads: Upload[]) => uploads.map(({ file, name }) => ({ path: path.join(uploadsDir, file), name }))

// 撤回了排队的消息，它的附件不再用了
export function discardUploads(uploads: Upload[]) {
  for (const { file } of uploads) {
    rmSync(path.join(uploadsDir, file), { force: true })
  }
}
