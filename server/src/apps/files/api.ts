import { constants } from 'node:fs'
import { cp, lstat, mkdir, open, readdir, rename, rm, stat, unlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import { serveFile } from '../../files.js'
import type { Directory, FileEntry } from './types.js'

function absolute(value: unknown): string {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.includes('\0')) throw new Error('请输入绝对路径')
  return path.resolve(value)
}
function child(dir: string, value: unknown) {
  if (typeof value !== 'string' || !value || value === '.' || value === '..' || value.includes('/') || value.includes('\0'))
    throw new Error('文件名不能为空或包含 /')
  return path.join(dir, value)
}

export const filesApi = new Hono()
  .onError((error, c) => c.json({ error: error.message }, 400))
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
  .post('/operation', async (c) => {
    const body = await c.req.json()
    const source = absolute(body.path)
    switch (body.action) {
      case 'mkdir':
        await mkdir(child(source, body.name))
        break
      case 'rename':
        await cpNeverOverwrite(source, child(path.dirname(source), body.name), true)
        break
      case 'copy':
      case 'move': {
        const destination = child(absolute(body.destination), path.basename(source))
        await cpNeverOverwrite(source, destination, body.action === 'move')
        break
      }
      case 'trash': {
        if (source === '/' || source === os.homedir()) throw new Error('不能移除根目录或个人目录')
        const trash = path.join(os.homedir(), '.Trash')
        await mkdir(trash, { recursive: true })
        const name = path.basename(source)
        const destination = path.join(trash, (await exists(path.join(trash, name))) ? `${name}-${randomUUID()}` : name)
        await cpNeverOverwrite(source, destination, true)
        break
      }
      default:
        throw new Error('未知操作')
    }
    return c.json({ ok: true })
  })
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
    return c.json({ ok: true })
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
