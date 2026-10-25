import { describe, expect, it } from 'vitest'
import { parsePlayerCommand } from './commands.js'
import { MusicPlayers, parsePlayerReport } from './players.js'
import { createMusicApi } from './api.js'
import type { PlayerMessage, PlayerState } from './types.js'

const state: PlayerState = { track: null, status: 'idle', positionMs: 0, durationMs: 0, volume: 0.7, repeat: 'off', controls: { seek: false, volume: true } }
const json = (body: unknown) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
function setup() {
  let now = 1000
  const players = new MusicPlayers(() => now)
  const messages: PlayerMessage[] = []
  const id = players.connect('Phone', message => messages.push(message), () => {})
  players.report(id, { state })
  return { players, id, messages, advance: (ms: number) => { now += ms } }
}

describe('播放器指令生命周期', () => {
  it('接收不等于执行成功，重试不重复发送，其他播放器无法确认指令', async () => {
    const { players, id, messages } = setup()
    const api = createMusicApi([], players)
    const response = await api.request(`/players/${id}/commands`, json({ id: 'pause-1', command: { type: 'pause' } }))
    expect(response.status).toBe(202)
    expect(await response.json()).toMatchObject({ status: 'pending' })
    expect(players.submit(id, 'pause-1', { type: 'pause' }).status).toBe('pending')
    expect(messages).toHaveLength(1)
    const other = players.connect('Other', () => {}, () => {})
    expect(() => players.report(other, { state, result: { id: 'pause-1' } })).toThrow('播放器请求无效')
    expect((await api.request(`/players/${id}/report`, json({ state: { ...state, status: 'paused' }, result: { id: 'pause-1' } }))).status).toBe(204)
    expect(await (await api.request('/commands/pause-1')).json()).toMatchObject({ status: 'succeeded', state: { status: 'paused' } })
    expect((await api.request(`/players/${id}/commands`, json({ id: 'pause-1', command: { type: 'pause' } }))).status).toBe(200)
    expect((await api.request(`/players/${id}/commands`, json({ id: 'pause-1', command: { type: 'play' } }))).status).toBe(409)
  })

  it('忙时拒绝新指令，超时不被迟到回执改为成功', () => {
    const { players, id, advance } = setup()
    players.submit(id, 'one', { type: 'play' })
    expect(() => players.submit(id, 'two', { type: 'next' })).toThrow('另一条指令')
    advance(15000)
    expect(players.result('one')).toMatchObject({ status: 'failed', error: { code: 'timeout' } })
    players.report(id, { state: { ...state, status: 'playing' }, result: { id: 'one' } })
    expect(players.result('one').status).toBe('failed')
  })

  it('断线终止待确认指令，心跳过期清除播放器，重连不重放', () => {
    const { players, id, advance, messages } = setup()
    players.submit(id, 'one', { type: 'pause' })
    advance(45001)
    expect(players.list()).toEqual([])
    expect(players.result('one')).toMatchObject({ status: 'failed', error: { code: 'disconnected' } })
    const next = players.connect('Phone', () => {}, () => {})
    expect(next).not.toBe(id)
    expect(messages).toHaveLength(1)
    advance(3600000)
    expect(() => players.result('one')).toThrow('已过期')
  })

  it('播放失败保留执行端错误和状态，不伪报成功', () => {
    const { players, id } = setup()
    players.submit(id, 'play', { type: 'play' })
    players.report(id, { state: { ...state, status: 'error', error: 'Autoplay blocked' }, result: { id: 'play', error: 'Autoplay blocked' } })
    expect(players.result('play')).toMatchObject({ status: 'failed', error: { code: 'execution', message: 'Autoplay blocked' }, state: { status: 'error' } })
  })

  it('拒绝无效参数和不存在的目标，接口可发现指令结构', async () => {
    const api = createMusicApi([])
    expect((await api.request('/players/missing/commands', json({ id: 'one', command: { type: 'play' } }))).status).toBe(404)
    for (const command of [{ type: 'volume', volume: 2 }, { type: 'pause', extra: true }, { type: 'seek', positionMs: -1 }, { type: 'select', ref: { provider: '', id: 'a' } }, { type: 'repeat', repeat: 'invalid' }, { type: 'constructor' }]) {
      expect(parsePlayerCommand(command)).toBeUndefined()
      expect((await api.request('/players/missing/commands', json({ id: 'one', command }))).status).toBe(400)
    }
    expect(() => parsePlayerReport({ state: { ...state, durationMs: -1 } })).toThrow('播放器请求无效')
    expect(() => parsePlayerReport({ state: { ...state, volume: Infinity } })).toThrow('播放器请求无效')
    expect(await (await api.request('/')).json()).toMatchObject({ version: 1, playerCommandSchema: { oneOf: expect.any(Array) } })
  })
})
