import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = mkdtempSync(path.join(os.tmpdir(), 'kita-identity-'))
process.env.BINOS_ROOT = root
process.env.BINOS_TEST_INSTANCE = '1'
const { kitaApi } = await import('./api.js')
const { createKitaSession } = await import('./store.js')
const { identityPrompt, listMemories } = await import('./identity.js')

const newSession = (identity?: { read: string[]; write: string }) =>
  createKitaSession({ type: 'session', time: new Date().toISOString(), agent: 'claude', owner: 'kita', cwd: root, ...(identity && { identity }) })
const post = (url: string, body: unknown, method = 'POST') =>
  kitaApi.request(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

describe('喜多的记忆', () => {
  it('不带身份的 session 写不了记忆；带身份的只写到自己的范围，不能自己指定', async () => {
    expect((await post('/memories', { session: newSession(), text: '临时对话里说的' })).status).toBe(403)
    const session = newSession({ read: ['personal'], write: 'personal' })
    expect((await post('/memories', { session, text: '想去别的范围', scope: 'code' })).status).toBe(403)
    const res = await post('/memories', { session, text: '喜欢简短的回答', kind: 'inferred' })
    expect(await res.json()).toMatchObject({ memory: { scope: 'personal', kind: 'inferred', source: { type: 'session', owner: 'kita', session } } })
  })

  it('agent 不能把用户说过的改成推测，也动不了读不到的范围；改动前的版本可以恢复', async () => {
    const { memory } = (await (await post('/memories', { text: '叫我小明' })).json()) as { memory: { id: string } }
    const session = newSession({ read: ['personal'], write: 'personal' })
    await post(`/memories/${memory.id}`, { session, text: '叫我阿明', kind: 'inferred' }, 'PATCH')
    expect(listMemories().find((item) => item.id === memory.id)).toMatchObject({ text: '叫我阿明', kind: 'stated', history: [{ text: '叫我小明' }] })
    expect((await post(`/memories/${memory.id}/revert`, { session })).status).toBe(403)
    expect((await post(`/memories/${memory.id}/revert`, {})).status).toBe(200)
    expect(listMemories().find((item) => item.id === memory.id)).toMatchObject({ text: '叫我小明', history: [] })
    const other = newSession({ read: ['music'], write: 'music' })
    expect((await kitaApi.request(`/memories/${memory.id}?session=${other}`, { method: 'DELETE' })).status).toBe(403)
  })

  it('身份提示只带要读的范围里的记忆，推测的和确认的分开', async () => {
    await post('/memories', { text: '只给音乐用的', scope: 'music' })
    const prompt = identityPrompt({ read: ['personal'], write: 'personal' })
    expect(prompt).toContain('叫我小明')
    expect(prompt).not.toContain('只给音乐用的')
    expect(prompt.indexOf('喜欢简短的回答')).toBeGreaterThan(prompt.indexOf('用户还没确认'))
    const { memory } = (await (await post('/memories', { text: '要忘掉的' })).json()) as { memory: { id: string } }
    expect((await kitaApi.request(`/memories/${memory.id}`, { method: 'DELETE' })).status).toBe(204)
    expect(listMemories().some((item) => item.id === memory.id)).toBe(false)
  })
})

describe('喜多的照片', () => {
  const upload = (body: Uint8Array) => kitaApi.request('/profile/photos', { method: 'POST', body, headers: { 'Content-Type': 'application/octet-stream' } })

  it('按内容认格式，不看文件名；认不出的拒绝', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
    const res = await upload(png)
    expect(res.status).toBe(201)
    expect(((await res.json()) as { file: string }).file).toMatch(/^[0-9a-f]{32}\.png$/)
    const rejected = await upload(new TextEncoder().encode('<svg></svg>'))
    expect(rejected.status).toBe(415)
  })
})
