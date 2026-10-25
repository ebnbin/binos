import { existsSync, mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it, vi } from 'vitest'

const root = mkdtempSync(path.join(os.tmpdir(), 'kita-app-'))
process.env.BINOS_ROOT = root
process.env.BINOS_TEST_INSTANCE = '1'
const { kitaAppApi } = await import('./api.js')
const { kita } = await import('./conversations.js')
const { forApp } = await import('../../services/kita/index.js')
const { KitaSession } = await import('../../services/kita/sessions.js')

// 不真的启动 agent
vi.spyOn(KitaSession.prototype, 'send').mockResolvedValue(true)

const post = (url: string, body: unknown) =>
  kitaAppApi.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const start = async (body: unknown) => ((await (await post('/conversations', body)).json()) as { id: string }).id

it('临时对话不带身份；每个对话有自己的工作目录，删除对话时一起删掉', async () => {
  const personal = kita.getSession(await start({ text: '你好', agent: 'codex' }))!
  const temporary = kita.getSession(await start({ text: '你好', temporary: true }))!
  expect(personal.metadata()).toMatchObject({ agent: 'codex', identity: { read: ['personal'], write: 'personal' } })
  expect(temporary.metadata().identity).toBeUndefined()
  expect(temporary.metadata().cwd).not.toBe(personal.metadata().cwd)
  const cwd = temporary.metadata().cwd
  expect(existsSync(cwd)).toBe(true)
  expect((await post(`/conversations/${temporary.id}/delete`, {})).status).toBe(200)
  expect(existsSync(cwd)).toBe(false)
})

it('别的 app 的 session 不能通过喜多访问；agent 不认识时拒绝', async () => {
  const foreign = forApp('code').createSession({ agent: 'claude', cwd: root })
  expect((await post(`/conversations/${foreign.id}/messages`, { text: '你好' })).status).toBe(404)
  expect((await post(`/conversations/${foreign.id}/delete`, {})).status).toBe(404)
  expect((await post('/conversations', { text: '你好', agent: 'other' })).status).toBe(400)
})
