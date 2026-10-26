import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Innertube } from 'youtubei.js'
import type { CatalogPage, ProviderInfo } from './types.js'
import type { MusicProvider } from './provider.js'

const root = mkdtempSync(path.join(os.tmpdir(), 'binos-providers-'))
process.env.BINOS_ROOT = root
process.env.BINOS_TEST_INSTANCE = '1'
const { createMusicApi, musicApi } = await import('./api.js')
const { youtubeMusic } = await import('./youtubeMusic.js')
const { providerSettings } = await import('./settings.js')
const sample = { id: 'SJKoWAd5ySo', item_type: 'song', title: '晴天', artists: [{ name: '周杰伦' }], album: { id: 'album', name: '葉惠美' }, duration: { seconds: 270 } }
const api = (operation: string, query = 'SJKoWAd5ySo') => musicApi.request(`/providers/youtube-music/${operation}?q=${encodeURIComponent(query)}`)
beforeEach(() => { rmSync(path.join(root, 'Library', 'Apps', 'music'), { recursive: true, force: true }); youtubeMusic.configure!({ cookie: '', poToken: '' }) })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
afterAll(() => rmSync(root, { recursive: true, force: true }))

it('有限能力的其他来源可接入同一接口，不支持和缺少配置分别返回明确错误', async () => {
  const unavailable = { state: 'unsupported' } as const
  const search = vi.fn<NonNullable<MusicProvider['search']>>()
  const provider: MusicProvider = { info: () => ({ id: 'limited', name: '有限曲库', description: '', input: { references: [] }, configuration: { fields: [] }, capabilities: { resolve: unavailable, playback: unavailable, playlist: unavailable, recommendations: unavailable, lyrics: unavailable, search: { state: 'configuration-required', reason: '需要连接账号' } } }), search }
  const app = createMusicApi([provider])
  expect(await (await app.request('/providers/limited/search?q=test')).json()).toEqual({ error: { message: '需要连接账号', code: 'configuration' } })
  expect((await app.request('/providers/limited/lyrics?q=test')).status).toBe(422)
  expect(search).not.toHaveBeenCalled()
  expect((await app.request('/providers/limited/playlist?q=test')).status).toBe(422)
})

it('音乐搜索无需密钥，输出中立曲目；分页不能跨查询复用', async () => {
  type Page = { contents: unknown[]; has_continuation: boolean; getContinuation(): Promise<Page> }
  const getContinuation = vi.fn<() => Promise<Page>>()
  getContinuation.mockResolvedValue({ contents: [{ contents: [sample] }], has_continuation: false, getContinuation })
  const search = vi.fn<(query: string, filters: { type: string }) => Promise<unknown>>().mockResolvedValue({ contents: [{ contents: [sample, { ...sample, id: 'bad', item_type: 'album' }] }], has_continuation: true, getContinuation })
  vi.spyOn(Innertube, 'create').mockResolvedValue({ music: { search } } as unknown as Innertube)
  const result = await (await api('search', '晴天')).json() as CatalogPage
  expect(result.tracks).toMatchObject([{ title: '晴天', ref: { provider: 'youtube-music', id: sample.id }, album: { title: '葉惠美' }, durationMs: 270000 }])
  expect(search).toHaveBeenCalledWith('晴天', { type: 'song' })
  expect((await musicApi.request(`/providers/youtube-music/search?q=other&page=${result.nextPage}`)).status).toBe(400)
  const next = `/providers/youtube-music/search?q=${encodeURIComponent('晴天')}&page=${result.nextPage}`
  expect((await musicApi.request(next)).status).toBe(200)
  await musicApi.request(next)
  expect(getContinuation).toHaveBeenCalledOnce()
})

it('纯音频入口过滤视频轨、代理 Range，403 后重新解析且不暴露 CDN 地址', async () => {
  const decipher = vi.fn<() => Promise<string>>().mockResolvedValue('https://media.googlevideo.com/audio?expire=9999999999')
  const getBasicInfo = vi.fn<(id: string, options: { client: string }) => Promise<unknown>>().mockResolvedValue({ playability_status: { status: 'OK' }, streaming_data: { adaptive_formats: [
    { has_audio: true, has_video: true, mime_type: 'video/mp4', bitrate: 999, url: 'https://media.googlevideo.com/video', decipher: vi.fn<() => Promise<string>>() },
    { has_audio: true, has_video: false, mime_type: 'audio/mp4', content_length: 100, bitrate: 128, url: 'https://media.googlevideo.com/audio', decipher },
  ] } })
  vi.spyOn(Innertube, 'create').mockResolvedValue({ getBasicInfo, session: {} } as unknown as Innertube)
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(new Response(null, { status: 403 })).mockResolvedValueOnce(new Response(null, { status: 403 })).mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 206, headers: { 'Content-Type': 'audio/mp4', 'Content-Range': 'bytes 0-2/100', 'Content-Length': '3' } }))
  vi.stubGlobal('fetch', fetch)
  const source = await (await api('playback')).json()
  expect(source).toMatchObject({ kind: 'audio', url: expect.stringContaining('/api/apps/music/') })
  expect(JSON.stringify(source)).not.toContain('googlevideo')
  const response = await musicApi.request(`/providers/youtube-music/stream?id=${sample.id}`, { headers: { Range: 'bytes=0-2' } })
  expect(response.status).toBe(206)
  expect(response.headers.get('Content-Range')).toBe('bytes 0-2/100')
  expect((await response.arrayBuffer()).byteLength).toBe(3)
  expect(fetch.mock.calls[1][1]).toMatchObject({ headers: { Range: 'bytes=0-2' }, redirect: 'manual' })
  expect(getBasicInfo).toHaveBeenCalledTimes(2)
  expect(decipher).toHaveBeenCalledTimes(2)
})

it('来源返回异常媒体地址时拒绝请求，错误不泄露来源数据', async () => {
  vi.spyOn(Innertube, 'create').mockResolvedValue({ getBasicInfo: async () => ({ playability_status: { status: 'OK' }, streaming_data: { adaptive_formats: [{ has_audio: true, has_video: false, mime_type: 'audio/mp4', content_length: 100, url: 'x', bitrate: 1, decipher: async () => 'https://127.0.0.1/private?secret=value' }] } }), session: {} } as unknown as Innertube)
  const fetch = vi.fn<typeof globalThis.fetch>()
  vi.stubGlobal('fetch', fetch)
  const response = await api('playback')
  expect(response.status).toBe(502)
  expect(await response.text()).not.toContain('secret=value')
  expect(fetch).not.toHaveBeenCalled()
})

it('旧官方密钥继续有效，来源配置互不覆盖且读取只返回是否配置', async () => {
  const dir = path.join(root, 'Library', 'Apps', 'music')
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ youtubeApiKey: 'legacy-key' }))
  expect(providerSettings('youtube').apiKey).toBe('legacy-key')
  const response = await musicApi.request('/providers/youtube-music/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cookie: 'session=private-value' }) })
  expect(response.status).toBe(200)
  expect(await response.text()).not.toContain('private-value')
  expect(providerSettings('youtube').apiKey).toBe('legacy-key')
  expect((await (await musicApi.request('/providers')).json() as { providers: ProviderInfo[] }).providers.find(provider => provider.id === 'youtube')?.capabilities.search.state).toBe('available')
  expect((await musicApi.request('/providers/youtube/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cookie: 'wrong-provider' }) })).status).toBe(400)
})

it('浏览器开放范围请求被拆成有限分段并连续输出，支持尾部范围与非法范围', async () => {
  const { byteRange } = await import('./youtubeMusic.js')
  expect(byteRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 })
  expect(byteRange('bytes=50-', 100)).toEqual({ start: 50, end: 99 })
  expect(byteRange('bytes=0-500', 100)).toEqual({ start: 0, end: 99 })
  for (const range of ['bytes=-', 'bytes=-0', 'bytes=100-', 'bytes=2-1', 'bytes=0-1,3-4']) expect(byteRange(range, 100)).toBeUndefined()
  const length = 2 * 1024 * 1024 + 3
  vi.spyOn(Innertube, 'create').mockResolvedValue({ getBasicInfo: async () => ({ playability_status: { status: 'OK' }, streaming_data: { adaptive_formats: [{ has_audio: true, has_video: false, mime_type: 'audio/mp4', content_length: length, url: 'x', bitrate: 1, decipher: async () => 'https://media.googlevideo.com/audio' }] } }), session: {} } as unknown as Innertube)
  const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
    const match = /^bytes=(\d+)-(\d+)$/.exec(new Headers(init?.headers).get('Range') ?? '')!
    const start = Number(match[1]); const end = Number(match[2])
    expect(end - start + 1).toBeLessThanOrEqual(1024 * 1024)
    return new Response(new Uint8Array(end - start + 1), { status: 206, headers: { 'Content-Type': 'audio/mp4', 'Content-Range': `bytes ${start}-${end}/${length}` } })
  })
  vi.stubGlobal('fetch', fetch)
  const response = await musicApi.request(`/providers/youtube-music/stream?id=${sample.id}`, { headers: { Range: 'bytes=0-' } })
  expect(response.status).toBe(206)
  expect(response.headers.get('Content-Range')).toBe(`bytes 0-${length - 1}/${length}`)
  expect((await response.arrayBuffer()).byteLength).toBe(length)
  expect(fetch).toHaveBeenCalledTimes(4)
})

it('分片 MP4 的 moov 时长在任意范围的音频流中都被清零，非分片文件不改', async () => {
  const box = (type: string, ...parts: Uint8Array[]) => {
    const body = Buffer.concat(parts)
    const header = Buffer.alloc(8)
    header.writeUInt32BE(body.length + 8)
    header.write(type, 4, 'latin1')
    return Buffer.concat([header, body])
  }
  const full = (version: number, fields: number[]) => {
    const body = Buffer.alloc(4 + fields.reduce((sum, size) => sum + size, 0), 0xff)
    body[0] = version
    return body
  }
  const moov = (fragmented: boolean) => box('moov', box('mvhd', full(0, [4, 4, 4, 4, 80])), ...(fragmented ? [box('mvex', box('trex', full(0, [20])))] : []),
    box('trak', box('tkhd', full(1, [8, 8, 4, 4, 8, 60])), box('mdia', box('mdhd', full(0, [4, 4, 4, 4, 4])))))
  const file = Buffer.concat([box('ftyp', Buffer.from('dash')), moov(true), box('moof', Buffer.alloc(8, 0xff))])
  const { fragmentedDurationFields } = await import('./youtubeMusic.js')
  expect(fragmentedDurationFields(Buffer.concat([box('ftyp', Buffer.from('dash')), moov(false)]))).toEqual([])
  const fields = fragmentedDurationFields(file)
  expect(fields).toHaveLength(3)
  vi.spyOn(Innertube, 'create').mockResolvedValue({ getBasicInfo: async () => ({ playability_status: { status: 'OK' }, streaming_data: { adaptive_formats: [{ has_audio: true, has_video: false, mime_type: 'audio/mp4', content_length: file.length, url: 'x', bitrate: 1, decipher: async () => 'https://media.googlevideo.com/audio' }] } }), session: {} } as unknown as Innertube)
  vi.stubGlobal('fetch', vi.fn<typeof globalThis.fetch>(async (_url, init) => {
    const match = /^bytes=(\d+)-(\d+)$/.exec(new Headers(init?.headers).get('Range') ?? '')!
    const start = Number(match[1]); const end = Math.min(Number(match[2]), file.length - 1)
    return new Response(file.subarray(start, end + 1), { status: 206, headers: { 'Content-Type': 'audio/mp4', 'Content-Range': `bytes ${start}-${end}/${file.length}` } })
  }))
  const expected = Buffer.from(file)
  for (const [from, to] of fields) expected.fill(0, from, to)
  expect(expected.equals(file)).toBe(false)
  for (const start of [0, fields[1][0] + 2]) {
    const response = await musicApi.request(`/providers/youtube-music/stream?id=${sample.id}`, { headers: { Range: `bytes=${start}-` } })
    expect(Buffer.from(await response.arrayBuffer()).equals(expected.subarray(start))).toBe(true)
  }
})
