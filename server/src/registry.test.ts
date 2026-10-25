import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const root = mkdtempSync(path.join(os.tmpdir(), 'binos-test-'))
process.env.BINOS_ROOT = root
process.env.BINOS_TEST_INSTANCE = '1'
const { registryPath } = await import('./paths.js')

const app = { id: 'a1', name: 'A', icon: 'globe', url: 'https://a.example/' }

async function load() {
  vi.resetModules()
  const { api } = await import('./api.js')
  const { onChange } = await import('./events.js')
  const read = async () => (await api.request('/api/apps')).json()
  const write = (external: unknown, contentType = 'application/json') =>
    api.request('/api/apps', { method: 'PUT', body: JSON.stringify({ external }), headers: { 'Content-Type': contentType } })
  return { read, write, onChange }
}

describe('app 注册表', () => {
  it('整份替换后推送通知，后端重启后从文件恢复', async () => {
    const { write, read, onChange } = await load()
    const events: unknown[] = []
    const off = onChange((event) => events.push(event))
    expect((await write([{ ...app, name: ' A ' }])).status).toBe(204)
    off()
    expect(events).toEqual([{ type: 'apps' }])
    expect(await read()).toEqual({ external: [app] })
    expect(await (await load()).read()).toEqual({ external: [app] })
  })

  it('写入文件失败时，注册表保持原样', async () => {
    const { write, read } = await load()
    const before = await read()
    // 临时文件的位置被目录占住，写入时就会失败
    mkdirSync(`${registryPath}.tmp`)
    expect((await write([])).status).toBe(500)
    rmSync(`${registryPath}.tmp`, { recursive: true })
    expect(await read()).toEqual(before)
  })

  it('拒绝不合规的清单', async () => {
    const { write } = await load()
    for (const external of [
      undefined,
      [app, app],
      [{ ...app, id: 'A' }],
      [{ ...app, name: ' ' }],
      [{ ...app, url: 'javascript:alert(1)' }],
      [{ ...app, icon: undefined }],
    ]) {
      expect((await write(external)).status).toBe(400)
    }
    expect((await write([app], 'text/plain')).status).toBe(415)
  })
})
