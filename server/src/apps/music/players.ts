import { randomUUID } from 'node:crypto'
import type { PlayerCommand } from './commands.js'
import { ApiException } from '../../errors.js'
import type { CommandResult, PlayerErrorCode, PlayerMessage, PlayerReport, PlayerSnapshot, PlayerState } from './types.js'

export class PlayerError extends ApiException {
  constructor(message: string, code: PlayerErrorCode, status: 400 | 404 | 409 | 429) { super(status, code, message) }
}
const invalid = () => new PlayerError('播放器请求无效。', 'invalid-input', 400)
export function parsePlayerReport(value: unknown): PlayerReport {
  const body = value as PlayerReport | null
  const state = body?.state
  if (!state || !['idle', 'loading', 'playing', 'paused', 'ended', 'error'].includes(state.status) ||
    !['positionMs', 'durationMs', 'volume'].every(key => typeof state[key as keyof PlayerState] === 'number' && Number.isFinite(state[key as keyof PlayerState]) && Number(state[key as keyof PlayerState]) >= 0) ||
    state.volume > 1 || !['off', 'all', 'one'].includes(state.repeat) ||
    !state.controls || typeof state.controls.seek !== 'boolean' || typeof state.controls.volume !== 'boolean' ||
    (state.track !== null && (!state.track || typeof state.track.provider !== 'string' || !state.track.provider.length || state.track.provider.length > 100 || typeof state.track.id !== 'string' || !state.track.id.length || state.track.id.length > 500)) ||
    (state.error !== undefined && (typeof state.error !== 'string' || state.error.length > 2000)) ||
    (body.result !== undefined && (!body.result || typeof body.result.id !== 'string' || body.result.id.length > 100 || (body.result.error !== undefined && (typeof body.result.error !== 'string' || !body.result.error.length || body.result.error.length > 2000))))) throw invalid()
  return {
    state: { track: state.track && { provider: state.track.provider, id: state.track.id }, status: state.status, positionMs: state.positionMs, durationMs: state.durationMs, volume: state.volume, repeat: state.repeat, controls: { seek: state.controls.seek, volume: state.controls.volume }, ...(state.error !== undefined && { error: state.error }) },
    ...(body.result && { result: { id: body.result.id, ...(body.result.error && { error: body.result.error }) } }),
  }
}

// 进度照着上次报告的推算得出时不算变化，跳转了才算
const seekTolerance = 2000
function stateChanged({ state: before, updatedAt }: PlayerSnapshot, after: PlayerState, now: number) {
  if (!before) return true
  const { positionMs: was, ...rest } = before
  const { positionMs: is, ...next } = after
  if (JSON.stringify(rest) !== JSON.stringify(next)) return true
  const expected = was + (before.status === 'playing' ? now - updatedAt : 0)
  return Math.abs(is - expected) > seekTolerance
}

type Player = { snapshot: PlayerSnapshot; send: (message: PlayerMessage) => void; close: () => void }
export class MusicPlayers {
  private players = new Map<string, Player>()
  private commands = new Map<string, CommandResult>()
  private now: () => number
  private changed: () => void
  // changed：播放器上线、下线或播放状态变了
  constructor(now = Date.now, changed: () => void = () => {}) { this.now = now; this.changed = changed }

  checkCapacity() {
    this.sweep()
    if (this.players.size >= 32) throw new PlayerError('在线播放器过多。', 'capacity', 429)
  }
  connect(label: string, send: Player['send'], close: () => void) {
    this.checkCapacity()
    const id = randomUUID()
    this.players.set(id, { snapshot: { id, label, updatedAt: this.now(), state: null }, send, close })
    this.changed()
    return id
  }
  disconnect(id: string) {
    const player = this.players.get(id)
    if (!player) return
    this.players.delete(id)
    for (const command of this.commands.values()) if (command.playerId === id && command.status === 'pending') this.fail(command, 'disconnected', '播放器已断开；操作可能已执行，请重新查询状态。')
    player.close()
    this.changed()
  }
  private fail(command: CommandResult, code: NonNullable<CommandResult['error']>['code'], message: string) {
    command.status = 'failed'
    command.error = { code, message }
  }
  sweep() {
    const now = this.now()
    for (const [id, player] of this.players) if (now - player.snapshot.updatedAt > 45000) this.disconnect(id)
    for (const [id, command] of this.commands) {
      if (command.status === 'pending' && now >= command.expiresAt) this.fail(command, 'timeout', '未在期限内收到执行回执；操作可能已执行，请查询状态。')
      if (now - command.createdAt > 3600000) this.commands.delete(id)
    }
  }
  list() { this.sweep(); return [...this.players.values()].map(player => player.snapshot) }
  get(id: string) {
    this.sweep()
    const player = this.players.get(id)
    if (!player) throw new PlayerError('播放器不在线，请重新列出播放器。', 'not-found', 404)
    return player
  }
  report(id: string, report: PlayerReport) {
    const player = this.get(id)
    const result = report.result
    const command = result && this.commands.get(result.id)
    if (result && (!command || command.playerId !== id)) throw invalid()
    if (stateChanged(player.snapshot, report.state, this.now())) this.changed()
    player.snapshot = { ...player.snapshot, state: report.state, updatedAt: this.now() }
    if (command && command.status === 'pending') {
      command.state = report.state
      if (result?.error) this.fail(command, 'execution', result.error)
      else command.status = 'succeeded'
    }
  }
  submit(playerId: string, id: string, command: PlayerCommand) {
    this.sweep()
    if (!/^[\w-]{1,100}$/.test(id)) throw invalid()
    const prior = this.commands.get(id)
    if (prior) {
      if (prior.playerId !== playerId || JSON.stringify(prior.command) !== JSON.stringify(command)) throw new PlayerError('同一个指令 ID 不能用于不同操作。', 'conflict', 409)
      return prior
    }
    const player = this.get(playerId)
    if (!player.snapshot.state) throw new PlayerError('播放器尚未报告状态。', 'busy', 409)
    if ([...this.commands.values()].some(item => item.playerId === playerId && item.status === 'pending')) throw new PlayerError('播放器正在执行另一条指令。', 'busy', 409)
    if (this.commands.size >= 2000) throw new PlayerError('指令记录已满，请稍后重试。', 'capacity', 429)
    const createdAt = this.now()
    const result: CommandResult = { id, playerId, command, status: 'pending', createdAt, expiresAt: createdAt + 15000 }
    this.commands.set(id, result)
    try { player.send({ type: 'command', command: result }) }
    catch { this.disconnect(playerId) }
    return result
  }
  result(id: string) {
    this.sweep()
    const result = this.commands.get(id)
    if (!result) throw new PlayerError('指令不存在或已过期。', 'not-found', 404)
    return result
  }
}
