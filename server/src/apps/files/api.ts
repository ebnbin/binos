import { constants } from 'node:fs'
import { cp, lstat, mkdir, open, readdir, rename, rm, stat, unlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { apiErrorBody, badRequest, errorHandler, toApiException } from '../../errors.js'
import { serveFile } from '../../files.js'
import type { Directory, FileEntry, FileName, FileResult, FileResults, FileTransfer, FileTrash } from './types.js'

function absolute(value: unknown): string {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.includes('\0')) throw new Error('请输入绝对路径')
  return path.resolve(value)
}
function child(dir: string, value: unknown) {
  if (typeof value !== 'string' || !value || value === '.' || value === '..' || value.includes('/') || value.includes('\0'))
    throw new Error('文件名不能为空或包含 /')
  return path.join(dir, value)
}

const maxPaths = 1000
const nameBody = validator('json', (value): FileName => {
  const { path: file, name } = (value ?? {}) as Partial<Record<keyof FileName, unknown>>
  if (typeof file !== 'string' || typeof name !== 'string') throw badRequest()
  return { path: file, name }
})
const paths = (value: unknown): string[] => {
  if (!Array.isArray(value) || value.length === 0 || value.length > maxPaths || !value.every((item) => typeof item === 'string')) throw badRequest(`一次最多操作 ${maxPaths} 项`)
  return value as string[]
}
const transferBody = validator('json', (value): FileTransfer => {
  const body = (value ?? {}) as Partial<Record<keyof FileTransfer, unknown>>
  if (typeof body.destination !== 'string') throw badRequest()
  return { paths: paths(body.paths), destination: body.destination }
})
const trashBody = validator('json', (value): FileTrash => ({ paths: paths((value as Partial<Record<keyof FileTrash, unknown>> | null)?.paths) }))

// 一项一项地做，一项出错不影响其他的
async function each(items: string[], run: (source: string) => Promise<void>): Promise<FileResults> {
  const results: FileResult[] = []
  for (const item of items) {
    try {
      await run(absolute(item))
      results.push({ path: item })
    } catch (error) {
      results.push({ path: item, error: apiErrorBody(toApiException(error as Error, [400, 'invalid-input'])).error })
    }
  }
  return { results }
}

function transfer({ paths, destination }: FileTransfer, move: boolean) {
  const dir = absolute(destination)
  return each(paths, (source) => cpNeverOverwrite(source, child(dir, path.basename(source)), move))
}

export const filesApi = new Hono()
  // 文件操作的错误是给用户看的原因
  .onError(errorHandler([400, 'invalid-input']))
  .get('/', async (c) => {
    const dir = absolute(c.req.query('path') || os.homedir())
    const names = await readdir(dir)
    const entries = await Promise.all(
      names.map(async (name): Promise<FileEntry> => {
        const file = path.join(dir, name)
        try {
          const info = await lstat(file)
          const target = info.isSymbolicLink() ? await stat(file).catch(() => null) : info
          return { name, path: file, directory: target?.isDirectory() ?? false, symlink: info.isSymbolicLink(), size: info.size, modified: info.mtimeMs }
        } catch {
          return { name, path: file, directory: false, symlink: false, size: 0, modified: 0 }
        }
      }),
    )
    return c.json({ path: dir, parent: path.dirname(dir), home: os.homedir(), entries } satisfies Directory)
  })
  .get('/download', async (c) => {
    const file = absolute(c.req.query('path'))
    return serveFile(c, file)
  })
  .post('/directories', nameBody, async (c) => {
    const { path: dir, name } = c.req.valid('json')
    await mkdir(child(absolute(dir), name))
    return c.body(null, 204)
  })
  .post('/rename', nameBody, async (c) => {
    const source = absolute(c.req.valid('json').path)
    await cpNeverOverwrite(source, child(path.dirname(source), c.req.valid('json').name), true)
    return c.body(null, 204)
  })
  .post('/copy', transferBody, async (c) => c.json(await transfer(c.req.valid('json'), false)))
  .post('/move', transferBody, async (c) => c.json(await transfer(c.req.valid('json'), true)))
  // 移到废纸篓，同名的加上随机后缀
  .post('/trash', trashBody, async (c) =>
    c.json(
      await each(c.req.valid('json').paths, async (source) => {
        if (source === '/' || source === os.homedir()) throw new Error('不能移除根目录或个人目录')
        const trash = path.join(os.homedir(), '.Trash')
        await mkdir(trash, { recursive: true })
        const name = path.basename(source)
        await cpNeverOverwrite(source, path.join(trash, (await exists(path.join(trash, name))) ? `${name}-${randomUUID()}` : name), true)
      }),
    ),
  )
  .post('/upload', async (c) => {
    const file = child(absolute(c.req.query('path')), c.req.query('name'))
    const handle = await open(file, 'wx')
    try {
      if (c.req.raw.body) {
        for await (const chunk of c.req.raw.body) await handle.writeFile(chunk)
      }
    } catch (error) {
      await unlink(file).catch(() => {})
      throw error
    } finally {
      await handle.close()
    }
    return c.body(null, 204)
  })

async function cpNeverOverwrite(source: string, destination: string, move: boolean) {
  if (source === '/' || source === destination || destination.startsWith(`${source}/`)) throw new Error('目标不能是原位置或其子目录')
  if (await exists(destination)) throw new Error('目标已存在同名文件')
  if (move) {
    try {
      await rename(source, destination)
      return
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
    }
  }
  await cp(source, destination, { recursive: true, force: false, errorOnExist: true, mode: constants.COPYFILE_EXCL, verbatimSymlinks: true })
  if (move) await rm(source, { recursive: true })
}

async function exists(file: string) {
  try {
    await lstat(file)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}
