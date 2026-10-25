import type { ProviderInfo } from './types.js'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseYouTubeInput } from './youtube.js'

const root = mkdtempSync(path.join(os.tmpdir(), 'binos-music-'))
process.env.BINOS_ROOT = root
process.env.BINOS_TEST_INSTANCE = '1'
const { musicApi } = await import('./api.js')
const settingsFile = path.join(root, 'Library', 'Apps', 'music', 'settings.json')
const settings = (youtubeApiKey: unknown) => musicApi.request('/providers/youtube/settings', { method: 'PUT', body: JSON.stringify({ apiKey: youtubeApiKey }), headers: { 'Content-Type': 'application/json' } })
beforeEach(() => rmSync(path.dirname(settingsFile), { recursive: true, force: true }))
afterEach(() => vi.unstubAllGlobals())
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('YouTube 内容入口', () => {
  it('识别音乐、短链和公开歌单，拒绝伪装主机与任意 URL', () => {
    for (const input of ['https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=PLabcdefghijk', 'https://youtu.be/dQw4w9WgXcQ?si=123', 'https://www.youtube.com/shorts/dQw4w9WgXcQ', 'dQw4w9WgXcQ']) {
      expect(parseYouTubeInput(input)).toEqual({ kind: 'track', id: 'dQw4w9WgXcQ' })
    }
    expect(parseYouTubeInput('https://www.youtube.com/playlist?list=PLabcdefghijk')).toEqual({ kind: 'playlist', id: 'PLabcdefghijk' })
    for (const input of ['https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ', 'https://youtube.com@127.0.0.1/watch?v=dQw4w9WgXcQ', 'https://youtube.com:123/watch?v=dQw4w9WgXcQ', 'file:///etc/passwd', 'https://localhost/']) expect(parseYouTubeInput(input)).toBeUndefined()
  })

  it('缺少搜索配置和无效链接不发起上游请求', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
    vi.stubGlobal('fetch', fetch)
    const missing = await musicApi.request('/providers/youtube/search?q=hello')
    expect(missing.status).toBe(409)
    expect(await missing.json()).toMatchObject({ error: { code: 'configuration' } })
    expect((await musicApi.request('/providers/youtube/resolve?q=https://localhost/private')).status).toBe(400)
    expect(fetch).not.toHaveBeenCalled()
    expect((await musicApi.request('/providers/unknown/search?q=hello')).status).toBe(422)
  })

  it('搜索密钥只写入受限文件，读取设置不会泄露密钥', async () => {
    expect((await settings('test-search-key')).status).toBe(200)
    expect(JSON.parse(readFileSync(settingsFile, 'utf8'))).toEqual({ providers: { youtube: { apiKey: 'test-search-key' } } })
    expect(statSync(settingsFile).mode & 0o777).toBe(0o600)
    const response = await musicApi.request('/providers')
    const data = await response.json() as { providers: ProviderInfo[] }
    expect(JSON.stringify(data)).not.toContain('test-search-key')
    expect(data.providers.find(provider => provider.id === 'youtube')!.configuration.fields[0].configured).toBe(true)
    expect((await settings('bad\nkey')).status).toBe(400)
    expect((await settings(null)).status).toBe(400)
  })

  it('上游额度错误不泄露上游内容，密钥通过请求头传递', async () => {
    await settings('test-search-key')
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ error: { errors: [{ reason: 'quotaExceeded' }], message: 'sensitive upstream data' } }, { status: 403 }))
    vi.stubGlobal('fetch', fetch)
    const response = await musicApi.request('/providers/youtube/search?q=hello')
    expect(response.status).toBe(429)
    expect(await response.json()).toMatchObject({ error: { code: 'quota' } })
    const [url, options] = fetch.mock.calls[0] as unknown as [URL, RequestInit]
    expect(url.href).not.toContain('test-search-key')
    expect(options.headers).toMatchObject({ 'X-Goog-Api-Key': 'test-search-key' })
  })

  it('歌单保留分页并过滤删除项，元数据网络失败时仍能添加单曲', async () => {
    await settings('test-search-key')
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ nextPageToken: 'next-page', items: [
      { snippet: { title: 'Track', videoOwnerChannelTitle: 'Artist', resourceId: { videoId: 'dQw4w9WgXcQ' } } },
      { snippet: { title: 'Private video', resourceId: { videoId: 'dQw4w9WgXcQ' } } },
    ] })))
    const response = await musicApi.request('/providers/youtube/resolve?q=' + encodeURIComponent('https://www.youtube.com/playlist?list=PLabcdefghijk'))
    expect(await response.json()).toMatchObject({ nextPage: 'next-page', tracks: [{ title: 'Track', artists: ['Artist'], ref: { provider: 'youtube', id: 'dQw4w9WgXcQ' } }] })
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    const fallback = await musicApi.request('/providers/youtube/resolve?q=dQw4w9WgXcQ')
    expect(await fallback.json()).toMatchObject({ warning: expect.any(String), tracks: [{ ref: { provider: 'youtube', id: 'dQw4w9WgXcQ' } }] })
  })
})
