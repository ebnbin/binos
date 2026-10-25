import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('./repositories.js', async (original) => ({
  ...await original<typeof import('./repositories.js')>(),
  prepareRepository: vi.fn<typeof import('./repositories.js').prepareRepository>(async (_id: string, repository: string) => ({ repository, defaultBranch: 'develop' })),
}))

const root = mkdtempSync(path.join(os.tmpdir(), 'binos-test-'))
process.env.BINOS_ROOT = root
process.env.BINOS_TEST_INSTANCE = '1'
const { api } = await import('../../api.js')
const { appendEntries, createKitaSession, filesDir } = await import('../../services/kita/store.js')
const { createSession, readSession, searchContent, searchSessions, sessionTitle, setUserState } = await import('./sessions.js')
const time = () => new Date().toISOString()

// 新的 session 和它的 thread，第一句是 text
function newSession(text: string) {
  const thread = createKitaSession({ type: 'session', time: time(), agent: 'claude', owner: 'code', cwd: root })
  appendEntries(thread, [{ type: 'input', time: time(), mode: 'start', text }])
  return { kitaSession: thread, id: createSession(thread) }
}

let thread: string
beforeAll(() => {
  thread = newSession('测试').kitaSession
  mkdirSync(filesDir(thread), { recursive: true })
  writeFileSync(path.join(filesDir(thread), 'a-0.png'), 'png')
  writeFileSync(path.join(filesDir(thread), 'page.html'), '<script></script>')
  writeFileSync(path.join(root, 'Library', 'secret.png'), 'secret')
})

const post = (url: string, body: string, contentType: string, method = 'POST') =>
  api.request(url, { method, body, headers: { 'Content-Type': contentType } })

describe('api', () => {
  it('写操作只接受 JSON', async () => {
    const form = await post('/api/apps/code/sessions', 'text=hi', 'application/x-www-form-urlencoded')
    expect(form.status).toBe(415)
    expect(await form.json()).toMatchObject({ error: { code: 'unsupported-media-type' } })
    expect((await post('/api/apps/code/sessions/1/stop', '', 'text/plain')).status).toBe(415)
  })

  it('出错和没有的接口都返回统一格式的 JSON', async () => {
    const missing = await api.request('/api/apps/code/nothing')
    expect(missing.status).toBe(404)
    expect(await missing.json()).toMatchObject({ error: { code: 'not-found' } })
    const malformed = await post('/api/apps/code/sessions', '{', 'application/json')
    expect(malformed.status).toBe(400)
    expect(await malformed.json()).toMatchObject({ error: { code: 'invalid-input' } })
  })

  it('附件超过上限时拒绝，不留下文件', async () => {
    const res = await api.request('/api/apps/code/uploads', {
      method: 'POST',
      body: new Uint8Array(50 * 1024 * 1024 + 1),
      headers: { 'Content-Type': 'application/octet-stream' },
    })
    expect(res.status).toBe(413)
    expect(readdirSync(path.join(root, 'Library', 'Apps', 'code', 'uploads'))).toEqual([])
  })

  it('消息只能带上传过的附件', async () => {
    const upload = await api.request('/api/apps/code/uploads', {
      method: 'POST',
      body: 'hi',
      headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent('笔记.txt') },
    })
    const { file } = (await upload.json()) as { file: string }
    expect(file).toMatch(/^[0-9a-f]{32}\.txt$/)
    for (const attachments of [[{ file: 'missing.txt', name: 'a' }], [{ file: '../session.json', name: 'a' }], [{ file }, { file }]]) {
      expect((await post('/api/apps/code/sessions', JSON.stringify({ text: '', attachments }), 'application/json')).status).toBe(400)
    }
  })

  it('thread 里网页类的文件只能下载，不在页面里打开', async () => {
    const html = await api.request(`/api/kita/sessions/${thread}/files/page.html?name=${encodeURIComponent('页面.html')}`)
    expect(html.headers.get('Content-Type')).toBe('application/octet-stream')
    expect(html.headers.get('Content-Disposition')).toBe(`attachment; filename*=UTF-8''${encodeURIComponent('页面.html')}`)
    const image = await api.request(`/api/kita/sessions/${thread}/files/a-0.png`)
    expect(image.headers.get('Content-Disposition')).toBe('inline')
  })

  it('文件流支持范围读取、元数据和强制下载', async () => {
    const url = `/api/kita/sessions/${thread}/files/a-0.png`
    const range = await api.request(url, { headers: { Range: 'bytes=1-2' } })
    expect(range.status).toBe(206)
    expect(range.headers.get('Content-Range')).toBe('bytes 1-2/3')
    expect(await range.text()).toBe('ng')
    const suffix = await api.request(url, { headers: { Range: 'bytes=-1' } })
    expect(await suffix.text()).toBe('g')
    for (const value of ['bytes=3-', 'bytes=2-1', 'bytes=-', 'bytes=0-1,2-3']) {
      expect((await api.request(url, { headers: { Range: value } })).status).toBe(416)
    }
    const metadata = await api.request(url + '?info=1')
    expect(await metadata.json()).toMatchObject({ size: 3, type: 'image/png' })
    const download = await api.request(url + '?name=photo.png')
    expect(download.headers.get('Content-Disposition')).toBe("attachment; filename*=UTF-8''photo.png")
    writeFileSync(path.join(filesDir(thread), 'empty'), '')
    const empty = await api.request(`/api/kita/sessions/${thread}/files/empty`)
    expect(empty.status).toBe(200)
    expect(await empty.text()).toBe('')
  })

  it('只提供 thread 的 files/ 里的文件', async () => {
    const res = await api.request(`/api/kita/sessions/${thread}/files/a-0.png`)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('png')
    expect((await api.request(`/api/kita/sessions/${thread}/files/..%2F..%2Fsecret.png`)).status).toBe(404)
    expect((await api.request('/api/kita/sessions/..%2F..%2F/files/a-0.png')).status).toBe(404)
  })
})

describe('sessions', () => {
  it('标题默认是第一句话，改名后用改的名字；用户的整理和 thread 新增的条目互不影响', () => {
    const { kitaSession: thread, id } = newSession('原来的名字')
    setUserState(id, { pinned: true, title: '新名字' })
    appendEntries(thread, [{ type: 'input', time: time(), mode: 'start', text: '第二轮' }])
    expect(readSession(id)).toMatchObject({ pinned: true, title: '新名字', defaultTitle: '原来的名字' })
    setUserState(id, { title: undefined })
    expect(sessionTitle(readSession(id))).toBe('原来的名字')
  })

  it('按标题、用户的话和回复搜索，不看子 agent 的文字', () => {
    const { kitaSession: thread, id } = newSession('Alpha 计划')
    appendEntries(thread, [
      { type: 'text', time: time(), text: '关于 Beta 的回复' },
      { type: 'text', time: time(), text: 'Gamma', parent: 't1' },
    ])
    expect(searchSessions([id], 'alpha').has(id)).toBe(true)
    expect(searchSessions([id], 'BETA').has(id)).toBe(true)
    expect(searchSessions([id], 'gamma').has(id)).toBe(false)
  })

  it('记下 gh pr create 输出的 PR，别的命令输出里的 PR 链接不算', () => {
    const { kitaSession: thread, id } = newSession('开个 PR')
    const pr = 'https://github.com/ebnbin/binos/pull/41'
    const command = (callId: string, text: string) =>
      ({ type: 'tool_call', time: time(), id: callId, name: 'Bash', tool: { kind: 'command', command: text } }) as const
    appendEntries(thread, [
      command('t1', 'git push && gh pr create --fill && pnpm preview'),
      command('t2', 'gh pr view 40'),
      { type: 'tool_result', time: time(), callId: 't2', status: 'done', output: 'https://github.com/ebnbin/binos/pull/40' },
      { type: 'tool_result', time: time(), callId: 't1', status: 'done', output: `${pr}\n✓ PR #41 的预览：https://pr-41.binos.app` },
    ])
    expect(readSession(id)).toMatchObject({ prs: [pr], creatingPrs: [] })
  })
})


describe('全局内容搜索', () => {
  it('返回归档会话里的消息位置和匹配片段，区分标题和主对话', async () => {
    const { kitaSession: thread, id } = newSession('检索专用标题')
    setUserState(id, { archived: true })
    appendEntries(thread, [
      { type: 'text', time: time(), text: '前文 Needle 后文' },
      { type: 'text', time: time(), text: 'Needle 子任务', parent: 'child' },
    ])
    expect(searchContent('needle')).toEqual({ total: 1, results: [expect.objectContaining({
      id, archived: true, seq: 3, kind: 'text', before: '前文 ', match: 'Needle', after: ' 后文',
    })] })
    const res = await api.request('/api/apps/code/search?q=needle')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(searchContent('needle'))
    expect(searchContent('检索专用标题').results.map((result) => result.kind)).toEqual(['title', 'input'])
    expect(searchContent('   ')).toEqual({ total: 0, results: [] })
  })
})


describe('projects', () => {
  it('默认使用 binOS 项目，新对话保存项目，项目重读后仍存在', async () => {
    const legacy = newSession('旧项目对话')
    expect(readSession(legacy.id).project).toBe('binos')
    const created = await post('/api/apps/code/projects', JSON.stringify({ name: ' 第二个项目 ', repository: 'example/project' }), 'application/json')
    expect(created.status).toBe(201)
    const { project } = await created.json() as { project: { id: string; name: string; repository: string; defaultBranch: string } }
    expect(project).toMatchObject({ name: '第二个项目', repository: 'example/project', defaultBranch: 'develop' })
    const { projectDirectory } = await import('./projects.js')
    expect(projectDirectory(project.id)).toBe(path.join(root, 'Library/Apps/code/repositories', project.id, 'main'))
    expect(projectDirectory('binos')).not.toBe(projectDirectory(project.id))
    const listed = await api.request('/api/apps/code/projects')
    expect(((await listed.json()) as { projects: { id: string; name: string }[] }).projects).toContainEqual(project)
    const thread = createKitaSession({ type: 'session', time: time(), agent: 'claude', owner: 'code', cwd: root })
    expect(readSession(createSession(thread, project.id)).project).toBe(project.id)
    const invalid = await post('/api/apps/code/sessions', JSON.stringify({ text: 'hi', project: 'missing' }), 'application/json')
    expect(invalid.status).toBe(400)
  })

  it('拒绝空白和过长的项目名', async () => {
    for (const name of ['', '  ', 'x'.repeat(101)]) {
      expect((await post('/api/apps/code/projects', JSON.stringify({ name, repository: 'example/project' }), 'application/json')).status).toBe(400)
    }
  })
})

describe('项目仓库', () => {
  it('拒绝非法仓库输入', async () => {
    for (const repository of ['', 'missing-owner', '../repo', 'https://example.com/owner/repo', '--help', 'owner/repo/extra']) {
      expect((await post('/api/apps/code/projects', JSON.stringify({ name: '项目', repository }), 'application/json')).status).toBe(400)
    }
  })

  it('仓库初始化失败时不保存项目', async () => {
    const { prepareRepository, RepositoryError } = await import('./repositories.js')
    const before = await (await api.request('/api/apps/code/projects')).json()
    vi.mocked(prepareRepository).mockRejectedValueOnce(new RepositoryError('无法访问仓库'))
    const response = await post('/api/apps/code/projects', JSON.stringify({ name: '失败', repository: 'example/private', create: true }), 'application/json')
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: { code: 'invalid-input', message: '无法访问仓库' } })
    expect(await (await api.request('/api/apps/code/projects')).json()).toEqual(before)
  })

  it('旧项目未关联仓库时不能从 binOS 启动新对话，关联后使用独立目录', async () => {
    const { listProjects, projectDirectory } = await import('./projects.js')
    const file = path.join(root, 'Library/Apps/code/projects.json')
    writeFileSync(file, JSON.stringify([...listProjects(), { id: 'legacy', name: '旧项目' }]))
    const response = await post('/api/apps/code/sessions', JSON.stringify({ text: '开发', project: 'legacy' }), 'application/json')
    expect(await response.json()).toEqual({ error: { code: 'invalid-input', message: '请先为这个项目关联 GitHub 仓库' } })
    const connected = await post('/api/apps/code/projects/legacy/repository', JSON.stringify({ name: '旧项目', repository: 'example/legacy' }), 'application/json', 'PUT')
    expect(connected.status).toBe(200)
    expect(projectDirectory('legacy')).toBe(path.join(root, 'Library/Apps/code/repositories/legacy/main'))
    expect((await post('/api/apps/code/projects/legacy/repository', JSON.stringify({ name: '旧项目', repository: 'other/repo' }), 'application/json', 'PUT')).status).toBe(400)
  })
})


it('新项目的 agent 会话使用自己的仓库目录和开发指引', async () => {
  const { KitaSession } = await import('../../services/kita/sessions.js')
  const { threadOf } = await import('./sessions.js')
  const sent = vi.spyOn(KitaSession.prototype, 'send').mockResolvedValueOnce(true)
  try {
    const response = await post('/api/apps/code/sessions', JSON.stringify({ text: '开发新功能', project: 'legacy' }), 'application/json')
    expect(response.status).toBe(200)
    const { id } = await response.json() as { id: number }
    expect(threadOf(id).metadata()).toMatchObject({ cwd: path.join(root, 'Library/Apps/code/repositories/legacy/main') })
    expect(threadOf(id).metadata().instructions).toContain('example/legacy')
    expect(threadOf(id).metadata().instructions).toContain('gh pr create')
    expect(sent).toHaveBeenCalledOnce()
  } finally {
    sent.mockRestore()
  }
})
