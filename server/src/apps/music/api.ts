import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { HTTPException } from 'hono/http-exception'
import { streamSSE } from 'hono/streaming'
import { ApiException, errorHandler, notFound } from '../../errors.js'
import { connectedPreamble } from '../../sse.js'
import { parsePlayerCommand, playerCommandSchema } from './commands.js'
import { MusicPlayers, PlayerError, parsePlayerReport } from './players.js'
import { musicContract } from './contract.js'
import { validator } from 'hono/validator'
import { notifyChange } from '../../events.js'
import type { PlayerCommandRequest, PlayerMessage } from './types.js'
import { mutateQueue, readQueue } from './queue.js'
import { MusicError, requireCapability, type MusicProvider } from './provider.js'
import { youtubeOfficial } from './youtubeOfficial.js'
import { youtubeMusic } from './youtubeMusic.js'

const handleError = errorHandler()

export function createMusicApi(adapters: MusicProvider[], players = new MusicPlayers()) {
  const providers = new Map(adapters.map(provider => [provider.info().id, provider]))
  const getProvider = (id: string) => {
    const provider = providers.get(id)
    if (!provider) throw new MusicError('这个音乐来源暂不可用。', 'unsupported')
    return provider
  }
  return new Hono()
    .use('*', async (c, next) => { c.header('Cache-Control', 'no-store'); await next() })
    .use(bodyLimit({ maxSize: 2 * 1024 * 1024, onError: () => { throw new ApiException(413, 'too-large', '请求体不能超过 2 MiB。') } }))
    // 来源的库抛出的错误不外露，统一说暂时用不了
    .onError((error, c) => handleError(error instanceof HTTPException ? error : new MusicError('音乐来源暂时无法完成请求，请稍后重试或检查连接设置。', 'unavailable'), c))
    .get('/', (c) => c.json({ ...musicContract, playerCommandSchema }))
    .get('/players/connect', (c) => {
      const label = c.req.query('label')?.trim()
      if (!label || label.length > 100) throw new PlayerError('请输入不超过 100 字的播放器名称。', 'invalid-input', 400)
      players.checkCapacity()
      return streamSSE(c, async stream => {
        let finish = () => {}
        const done = new Promise<void>(resolve => { finish = resolve })
        const id = players.connect(label, message => {
          void stream.writeSSE({ data: JSON.stringify(message) }).catch(() => players.disconnect(id))
        }, finish)
        const timer = setInterval(() => players.sweep(), 5000)
        const ping = setInterval(() => { void stream.writeSSE({ event: 'ping', data: '' }).catch(() => players.disconnect(id)) }, 15000)
        stream.onAbort(() => players.disconnect(id))
        try {
          await stream.write(connectedPreamble)
          await stream.writeSSE({ data: JSON.stringify({ type: 'connected', playerId: id } satisfies PlayerMessage) })
          await done
        } finally {
          clearInterval(timer)
          clearInterval(ping)
          players.disconnect(id)
        }
      })
    })
    .get('/players', (c) => c.json({ players: players.list() }))
    .get('/players/:id', (c) => c.json(players.get(c.req.param('id')).snapshot))
    .post('/players/:id/report', async (c) => {
      players.report(c.req.param('id'), parsePlayerReport(await c.req.json().catch(() => null)))
      return c.json({ ok: true })
    })
    .post('/players/:id/commands', async (c) => {
      const body = await c.req.json().catch(() => null) as { [K in keyof PlayerCommandRequest]?: unknown } | null
      const command = parsePlayerCommand(body?.command)
      if (typeof body?.id !== 'string' || !command) throw new PlayerError('请输入指令 ID 和有效的 command。', 'invalid-input', 400)
      const result = players.submit(c.req.param('id'), body.id, command)
      return c.json(result, result.status === 'pending' ? 202 : 200)
    })
    .get('/commands/:id', (c) => c.json(players.result(c.req.param('id'))))
    .get('/queue', (c) => c.json(readQueue()))
    .post('/queue', async (c) => c.json(mutateQueue(await c.req.json().catch(() => null))))
    .get('/providers', (c) => c.json({ providers: adapters.map(provider => provider.info()) }))
    .put('/providers/:provider/settings', validator('json', (value: unknown) => value), async (c) => {
      const provider = getProvider(c.req.param('provider'))
      if (!provider.configure) throw new MusicError('这个音乐来源没有可配置的连接参数。', 'unsupported')
      const body = c.req.valid('json')
      const fields = provider.info().configuration.fields
      if (!body || typeof body !== 'object' || Array.isArray(body) || !Object.keys(body).length || Object.entries(body).some(([key, value]) => !fields.some(field => field.id === key) || typeof value !== 'string' || value.length > 16000 || /[\r\n\0]/.test(value))) throw new MusicError('连接参数无效，请检查后重试。', 'invalid-input')
      provider.configure(body as Record<string, string>)
      notifyChange({ type: 'music' })
      return c.json(provider.info())
    })
    .get('/providers/:provider/stream', async (c) => {
      const provider = getProvider(c.req.param('provider'))
      requireCapability(provider, 'playback')
      if (!provider.stream) throw new MusicError('此来源不支持音频流传输。', 'unsupported')
      return provider.stream(c.req.query('id') ?? '', c.req.header('range'), c.req.raw.signal)
    })
    .get('/providers/:provider/:operation', validator('query', (value) => {
      const query = typeof value.q === 'string' ? value.q.trim() : ''
      const page = typeof value.page === 'string' ? value.page : undefined
      if (!query || query.length > 500 || (page && (page.length > 300 || !/^[\w=-]+$/.test(page)))) throw new MusicError('请输入有效的查询内容。', 'invalid-input')
      return { q: query, page }
    }), async (c) => {
      const provider = getProvider(c.req.param('provider'))
      const operation = c.req.param('operation')
      const { q, page } = c.req.valid('query')
      if (operation === 'playback') {
        requireCapability(provider, 'playback')
        if (!provider.playback) throw new MusicError('此来源未提供播放能力。', 'unsupported')
        return c.json(await provider.playback({ provider: provider.info().id, id: q }))
      }
      if (operation === 'lyrics') {
        requireCapability(provider, 'lyrics')
        if (!provider.lyrics) throw new MusicError('此来源未提供歌词能力。', 'unsupported')
        return c.json(await provider.lyrics(q))
      }
      if (operation !== 'search' && operation !== 'resolve' && operation !== 'playlist' && operation !== 'recommendations') throw notFound('没有这项曲库能力')
      requireCapability(provider, operation)
      const method = provider[operation]
      if (!method) throw new MusicError('此来源未提供这项曲库能力。', 'unsupported')
      return c.json(await method(q, page))
    })
}
export const musicApi = createMusicApi([youtubeMusic, youtubeOfficial])
export type MusicApi = typeof musicApi
