import { Innertube, Misc, Constants } from 'youtubei.js'
import { MusicError, type MusicProvider } from './provider.js'
import { providerSettings, saveProviderSettings } from './settings.js'
import { parseYouTubeInput, youtubeInputRules } from './youtube.js'
import type { CatalogPage, Track } from './types.js'

type MusicPage = { contents?: unknown; has_continuation: boolean; getContinuation(): Promise<MusicPage> }
const idPattern = /^[\w-]{11}$/
function validId(id: string) { if (!idPattern.test(id)) throw new MusicError('曲目标识无效。', 'invalid-input') }
const text = (value: unknown): string => typeof value === 'string' ? value : value instanceof Misc.Text ? value.toString() : ''

export function musicTracks(contents: unknown): Track[] {
  if (!Array.isArray(contents)) return []
  return contents.flatMap((value: unknown): Track[] => {
    if (!value || typeof value !== 'object') return []
    const item = value as { contents?: unknown; id?: string; video_id?: string; item_type?: string; title?: unknown; artists?: { name: string }[]; author?: string; album?: { id?: string; name: string }; thumbnails?: { url: string }[]; thumbnail?: { url: string }[]; duration?: { seconds: number } }
    if (Array.isArray(item.contents)) return musicTracks(item.contents)
    const id = item.video_id ?? item.id
    if (!id || !idPattern.test(id) || (item.item_type && !['song', 'video'].includes(item.item_type))) return []
    const title = text(item.title)
    if (!title) return []
    const images = item.thumbnails ?? (Array.isArray(item.thumbnail) ? item.thumbnail : [])
    return [{ ref: { provider: 'youtube-music', id }, title,
      artists: item.artists?.map(artist => artist.name) ?? (typeof item.author === 'string' ? [item.author] : []),
      album: item.album ? { id: item.album.id, title: item.album.name } : undefined,
      artworkUrl: images.at(-1)?.url ?? `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
      durationMs: item.duration?.seconds ? item.duration.seconds * 1000 : undefined,
      externalUrl: `https://music.youtube.com/watch?v=${id}` }]
  })
}

let session: Promise<Innertube> | undefined
const continuations = new Map<string, { scope: string; expires: number; load(): Promise<CatalogPage> }>()
const audio = new Map<string, { url: string; expires: number; length: number; durationFields?: Promise<[number, number][]> }>()
function reset() { session = undefined; continuations.clear(); audio.clear() }
function client() {
  session ??= Innertube.create({ lang: 'zh-CN', location: 'US', cookie: providerSettings('youtube-music').cookie || undefined,
    po_token: providerSettings('youtube-music').poToken || undefined,
    fetch: (input, init = {}) => fetch(input, { ...init, signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) }),
  }).catch(() => { session = undefined; throw new MusicError('无法连接音乐来源，请稍后重试。', 'network') })
  return session
}
function remember(page: MusicPage, scope: string): CatalogPage {
  const contents = Array.isArray(page.contents) ? page.contents : (page.contents as { contents?: unknown } | undefined)?.contents
  const result: CatalogPage = { tracks: musicTracks(contents) }
  if (page.has_continuation) {
    while (continuations.size >= 100) continuations.delete(continuations.keys().next().value!)
    const token = crypto.randomUUID()
    let loaded: Promise<CatalogPage> | undefined
    continuations.set(token, { scope, expires: Date.now() + 600000, load: () => loaded ??= page.getContinuation().then(next => remember(next, scope)).catch(error => { loaded = undefined; throw error }) })
    result.nextPage = token
  }
  return result
}
async function continuation(token: string, scope: string) {
  const entry = continuations.get(token)
  if (!entry || entry.scope !== scope || entry.expires < Date.now()) throw new MusicError('这次查询已过期，请重新查找。', 'invalid-input')
  return entry.load()
}
async function musicPlaylist(input: string, page?: string) {
  const ref = parseYouTubeInput(input)
  if (ref?.kind !== 'playlist') throw new MusicError('请输入有效的歌单链接。', 'invalid-input')
  const scope = `playlist:${input}`
  if (page) return continuation(page, scope)
  return remember(await (await client()).music.getPlaylist(ref.id), scope)
}
function safeMediaUrl(value: string): URL {
  const url = new URL(value)
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.googlevideo.com') || url.port || url.username || url.password) throw new MusicError('音乐来源返回了无效的音频地址。', 'unavailable')
  return url
}
async function resolveAudio(id: string, refresh = false) {
  validId(id)
  const cached = audio.get(id)
  if (!refresh && cached && cached.expires > Date.now() + 60000) return cached
  const yt = await client()
  // Use a client exposing standalone AAC; catalog metadata comes from the Music client.
  const info = await yt.getBasicInfo(id, { client: 'VISIONOS' })
  if (info.playability_status?.status !== 'OK') throw new MusicError('此曲目暂不可播放，可能受账号或地区限制。', 'unavailable')
  const formats = info.streaming_data?.adaptive_formats.filter(format => format.has_audio && !format.has_video && !format.drm_families?.length && format.mime_type.startsWith('audio/mp4') && (format.url || format.signature_cipher || format.cipher)) ?? []
  const format = formats.sort((a, b) => b.bitrate - a.bitrate)[0]
  if (!format) throw new MusicError('此曲目暂未提供可用的纯音频格式。', 'unavailable')
  const url = safeMediaUrl(await format.decipher(yt.session.player))
  const expiry = Number(url.searchParams.get('expire')) * 1000
  if (!Number.isSafeInteger(format.content_length) || !format.content_length || format.content_length < 1) throw new MusicError('此曲目没有可用的音频长度信息。', 'unavailable')
  const result = { url: url.href, length: format.content_length, expires: Number.isFinite(expiry) && expiry > Date.now() ? expiry : Date.now() + 300000 }
  while (audio.size >= 100) audio.delete(audio.keys().next().value!)
  audio.set(id, result)
  return result
}
// Apple players add the moov duration to the fragment durations of fragmented MP4, so the
// stream reports these fields as 0 and players derive the duration from the fragments.
export function fragmentedDurationFields(head: Uint8Array): [number, number][] {
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength)
  const boxes = (start: number, end: number) => {
    const found: { type: string; start: number; end: number }[] = []
    for (let offset = start; offset + 8 <= end;) {
      const size = view.getUint32(offset)
      if (size < 8 || offset + size > end) break
      found.push({ type: String.fromCharCode(...head.subarray(offset + 4, offset + 8)), start: offset, end: offset + size })
      offset += size
    }
    return found
  }
  const moov = boxes(0, head.length).find(box => box.type === 'moov')
  if (!moov || !boxes(moov.start + 8, moov.end).some(box => box.type === 'mvex')) return []
  const fields: [number, number][] = []
  const visit = (start: number, end: number) => {
    for (const box of boxes(start, end)) {
      if (box.type === 'trak' || box.type === 'mdia') { visit(box.start + 8, box.end); continue }
      const wide = head[box.start + 8] === 1
      const offset = box.type === 'mvhd' || box.type === 'mdhd' ? (wide ? 32 : 24) : box.type === 'tkhd' ? (wide ? 36 : 28) : 0
      if (offset && box.start + offset + (wide ? 8 : 4) <= box.end) fields.push([box.start + offset, box.start + offset + (wide ? 8 : 4)])
    }
  }
  visit(moov.start + 8, moov.end)
  return fields
}
async function durationFields(resource: { url: string; length: number; durationFields?: Promise<[number, number][]> }) {
  resource.durationFields ??= fetchAudio(resource.url, `bytes=0-${Math.min(65535, resource.length - 1)}`, AbortSignal.timeout(15000))
    .then(async response => {
      if (response.status !== 206) { await response.body?.cancel(); throw new Error('unavailable') }
      return fragmentedDurationFields(new Uint8Array(await response.arrayBuffer()))
    })
    .catch(() => { resource.durationFields = undefined; return [] })
  return resource.durationFields
}
async function fetchAudio(url: string, range: string | undefined, signal: AbortSignal) {
  for (let i = 0; i < 4; i++) {
    const response = await fetch(safeMediaUrl(url), { headers: { 'User-Agent': Constants.CLIENTS.VISIONOS.USER_AGENT, ...(range ? { Range: range } : {}) }, redirect: 'manual', signal })
    if (![301, 302, 303, 307, 308].includes(response.status)) return response
    const location = response.headers.get('location')
    await response.body?.cancel()
    if (!location) break
    url = new URL(location, url).href
  }
  throw new MusicError('音频重定向失败，请重试。', 'network')
}

export const youtubeMusic: MusicProvider = {
  info() {
    const settings = providerSettings('youtube-music')
    const available = { state: 'available' } as const
    return { id: 'youtube-music', name: 'YouTube Music', description: '音乐曲库搜索、推荐和歌词；纯音频播放，无需开发者密钥。',
      input: { references: youtubeInputRules },
      capabilities: { search: available, resolve: available, playlist: available, playback: available, recommendations: available, lyrics: available },
      stream: { provider: 'youtube-music' },
      configuration: { fields: [
        { id: 'cookie', label: '账号会话（可选）', description: '仅在需要账号访问时配置浏览器 Cookie；保存在服务端，不会读取或显示已有值。', secret: true, configured: Boolean(settings.cookie) },
        { id: 'poToken', label: '访问验证令牌（可选）', description: '仅在音乐来源要求额外验证时配置 PO Token；不能替代账号登录。', secret: true, configured: Boolean(settings.poToken) },
      ] } }
  },
  configure(values) { saveProviderSettings('youtube-music', values); reset() },
  async search(query, page) {
    const scope = `search:${query}`
    if (page) return continuation(page, scope)
    return remember(await (await client()).music.search(query, { type: 'song' }), scope)
  },
  playlist: musicPlaylist,
  async resolve(input, page) {
    const ref = parseYouTubeInput(input)
    if (!ref) throw new MusicError('无法识别此音乐链接。', 'invalid-input')
    if (ref.kind === 'playlist') return musicPlaylist(input, page)
    if (page) throw new MusicError('单曲查询没有后续分页。', 'invalid-input')
    const info = await (await client()).getBasicInfo(ref.id, { client: 'VISIONOS' })
    if (!info.basic_info.title) throw new MusicError('未找到这首曲目。', 'unavailable')
    return { tracks: [{ ref: { provider: 'youtube-music', id: ref.id }, title: info.basic_info.title,
      artists: info.basic_info.author ? [info.basic_info.author] : [], artworkUrl: info.basic_info.thumbnail?.at(-1)?.url,
      durationMs: info.basic_info.duration ? info.basic_info.duration * 1000 : undefined, externalUrl: `https://music.youtube.com/watch?v=${ref.id}` }] }
  },
  async recommendations(id) { validId(id); return { tracks: musicTracks((await (await client()).music.getUpNext(id, true)).contents).filter(track => track.ref.id !== id) } },
  async lyrics(id) {
    validId(id)
    const lyrics = await (await client()).music.getLyrics(id)
    return { text: lyrics?.description.toString() ?? '', attribution: lyrics?.footer.toString() }
  },
  async playback(ref) {
    const resource = await resolveAudio(ref.id)
    return { kind: 'audio', url: `/api/apps/music/providers/youtube-music/stream?id=${encodeURIComponent(ref.id)}`, expiresAt: resource.expires, controls: { seek: true, volume: true } }
  },
  async stream(id, range, signal) {
    validId(id)
    let resource = await resolveAudio(id)
    const selection = byteRange(range, resource.length)
    if (!selection) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${resource.length}` } })
    const { start, end } = selection
    const abort = new AbortController()
    const streamSignal = AbortSignal.any([signal, abort.signal])
    const chunkSize = 1024 * 1024
    async function chunk(offset: number) {
      const last = Math.min(end, offset + chunkSize - 1)
      const requestedRange = `bytes=${offset}-${last}`
      let response = await fetchAudio(resource.url, requestedRange, streamSignal)
      if ([403, 410].includes(response.status)) {
        await response.body?.cancel()
        const refreshed = await resolveAudio(id, true)
        if (refreshed.length !== resource.length) throw new MusicError('音频资源已变化，请重新播放。', 'unavailable')
        resource = refreshed
        response = await fetchAudio(resource.url, requestedRange, streamSignal)
      }
      if (response.status !== 206 || !response.body || !response.headers.get('content-type')?.startsWith('audio/') || response.headers.get('content-range') !== `bytes ${offset}-${last}/${resource.length}`) {
        await response.body?.cancel()
        throw new MusicError('音频暂时无法读取，请重试或检查账号访问设置。', 'unavailable')
      }
      return { response, next: last + 1 }
    }
    const fields = await durationFields(resource)
    // Match the media client and use bounded ranges for CDN compatibility.
    let current = await chunk(start)
    const mime = current.response.headers.get('content-type')!
    let reader = current.response.body!.getReader()
    let position = start
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          while (true) {
            const result = await reader.read()
            if (!result.done) {
              for (const [from, to] of fields) {
                if (from < position + result.value.length && to > position) result.value.fill(0, Math.max(0, from - position), to - position)
              }
              position += result.value.length
              controller.enqueue(result.value)
              return
            }
            reader.releaseLock()
            if (current.next > end) { controller.close(); return }
            current = await chunk(current.next)
            reader = current.response.body!.getReader()
          }
        } catch { abort.abort(); controller.error(new Error('音频连接中断，请重新播放。')) }
      },
      async cancel() { abort.abort(); await reader.cancel().catch(() => {}) },
    })
    const headers = new Headers({ 'Cache-Control': 'no-store', 'Content-Type': mime, 'Accept-Ranges': 'bytes', 'Content-Length': String(end - start + 1) })
    if (range) headers.set('Content-Range', `bytes ${start}-${end}/${resource.length}`)
    return new Response(body, { status: range ? 206 : 200, headers })
  },
}

export function byteRange(range: string | undefined, length: number): { start: number; end: number } | undefined {
  if (!range) return { start: 0, end: length - 1 }
  const match = /^bytes=(\d*)-(\d*)$/.exec(range)
  if (!match || !match[1] && !match[2]) return undefined
  const start = match[1] ? Number(match[1]) : Math.max(0, length - Number(match[2]))
  const end = match[1] && match[2] ? Math.min(Number(match[2]), length - 1) : length - 1
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= length || (!match[1] && Number(match[2]) === 0)) return undefined
  return { start, end }
}
