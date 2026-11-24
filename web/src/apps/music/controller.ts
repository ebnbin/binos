import type { QueueOperation } from '../../contract.ts'
import type { MusicPlayer, MusicState, PlayerFactory, Track } from './types.ts'

const initial: MusicState = { queue: [], index: -1, status: 'idle', positionMs: 0, durationMs: 0, volume: 0.7, repeat: 'off' }
export const trackKey = (track: Track) => `${track.ref.provider}:${track.ref.id}`

export function restoreMusic(value: unknown): MusicState {
  if (!value || typeof value !== 'object') return initial
  const saved = value as Partial<MusicState>
  const queue = Array.isArray(saved.queue) ? saved.queue.filter((track) => track && typeof track.title === 'string' && track.ref && typeof track.ref.provider === 'string' && typeof track.ref.id === 'string' && Array.isArray(track.artists) && track.artists.every((artist) => typeof artist === 'string') && typeof track.externalUrl === 'string' && track.externalUrl.startsWith('https://')).slice(0, 500).map((track) => ({
    ...track,
    artworkUrl: typeof track.artworkUrl === 'string' && track.artworkUrl.startsWith('https://') ? track.artworkUrl : undefined,
    durationMs: typeof track.durationMs === 'number' && Number.isFinite(track.durationMs) && track.durationMs > 0 ? track.durationMs : undefined,
  })) : []
  return {
    ...initial, queue, index: queue.length ? Math.max(0, Math.min(queue.length - 1, Number.isInteger(saved.index) ? saved.index! : 0)) : -1,
    volume: typeof saved.volume === 'number' && Number.isFinite(saved.volume) ? Math.min(1, Math.max(0, saved.volume)) : initial.volume,
    repeat: saved.repeat === 'one' || saved.repeat === 'all' ? saved.repeat : 'off',
  }
}

export class MusicController {
  private state: MusicState
  private listeners = new Set<() => void>()
  private player?: MusicPlayer
  private generation = 0
  private wantsPlay = false
  private queueChanged?: (operation: QueueOperation) => void
  private createPlayer: PlayerFactory
  private persist?: (state: MusicState) => void

  constructor(createPlayer: PlayerFactory, restored?: unknown, persist?: (state: MusicState) => void, queueChanged?: (operation: QueueOperation) => void) {
    this.queueChanged = queueChanged
    this.createPlayer = createPlayer
    this.persist = persist
    this.state = restoreMusic(restored)
  }

  getSnapshot = () => this.state
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }

  private update(patch: Partial<MusicState>, save = false) {
    this.state = { ...this.state, ...patch }
    if (save) this.persist?.(this.state)
    this.listeners.forEach((listener) => listener())
  }

  add(tracks: Track[], play = false) {
    const queue = [...this.state.queue]
    const known = new Set(queue.map(trackKey))
    for (const track of tracks) {
      if (!known.has(trackKey(track)) && queue.length < 500) { queue.push(track); known.add(trackKey(track)) }
    }
    const index = tracks[0] ? queue.findIndex((track) => trackKey(track) === trackKey(tracks[0])) : -1
    this.update({ queue, index: this.state.index < 0 && queue.length ? 0 : this.state.index }, true)
    this.queueChanged?.({ type: 'add', tracks })
    if (play && index >= 0) void this.select(index)
  }

  async select(index: number) {
    const track = this.state.queue[index]
    if (!track) return
    const generation = ++this.generation
    this.player?.destroy()
    this.player = undefined
    this.wantsPlay = true
    this.update({ index, status: 'loading', positionMs: 0, durationMs: track.durationMs ?? 0, error: undefined, controls: { seek: false, volume: false }, embedEngine: undefined }, true)
    try {
      const player = this.createPlayer(track.ref, (event) => {
        if (generation !== this.generation) return
        if (!this.wantsPlay && (event.status === 'playing' || event.status === 'loading')) {
          if (event.status === 'playing') this.player?.pause()
          this.update({ ...event, status: 'paused' })
          return
        }
        this.update(event.status ? { ...event, error: event.error } : event)
        if (event.status === 'ended' && this.wantsPlay) {
          if (this.state.repeat === 'one') void this.select(this.state.index)
          else this.next(true)
        }
      })
      if (!player) throw new Error('这个音乐来源暂不可用，请切换曲目。')
      this.player = player
      await player.load(track.ref)
      if (generation !== this.generation) return
      player.setVolume(this.state.volume)
      if (this.wantsPlay) player.play()
      else { player.pause(); this.update({ status: 'paused' }) }
    } catch (error) {
      if (generation === this.generation) {
        this.player?.destroy()
        this.player = undefined
        this.update({ status: 'error', error: error instanceof Error ? error.message : '无法播放这首曲目。' })
      }
    }
  }

  toggle() {
    if (this.state.status === 'playing' || this.state.status === 'loading') this.pause()
    else this.play()
  }

  play() {
    if (!this.state.queue.length) return
    this.wantsPlay = true
    if (this.state.status === 'playing' || this.state.status === 'loading') return
    if (this.player && this.state.status === 'paused') {
      this.update({ status: 'loading', error: undefined })
      this.player.play()
    } else void this.select(Math.max(0, this.state.index))
  }

  pause() { this.wantsPlay = false; this.player?.pause(); this.update({ status: 'paused', error: undefined }) }

  next(automatic = false) {
    const { queue, index, repeat } = this.state
    if (!queue.length) return
    if (index + 1 < queue.length) void this.select(index + 1)
    else if (repeat === 'all' || !automatic) void this.select(0)
  }

  previous() {
    if (!this.state.queue.length) return
    if (this.state.positionMs > 3000 && this.player) { this.seek(0); this.play() }
    else void this.select(Math.max(0, this.state.index - 1))
  }

  seek(positionMs: number) {
    if (!this.player || !Number.isFinite(positionMs) || !this.state.durationMs) return
    const position = Math.max(0, Math.min(positionMs, this.state.durationMs))
    this.player.seek(position)
    this.update({ positionMs: position })
  }

  setVolume(volume: number) {
    if (!Number.isFinite(volume)) return
    const next = Math.max(0, Math.min(1, volume))
    this.player?.setVolume(next)
    this.update({ volume: next }, true)
  }

  setRepeat(repeat: MusicState['repeat']) { this.update({ repeat }, true) }
  cycleRepeat() { this.setRepeat(this.state.repeat === 'off' ? 'all' : this.state.repeat === 'all' ? 'one' : 'off') }

  remove(index: number) {
    if (index < 0 || index >= this.state.queue.length) return
    this.queueChanged?.({ type: 'remove', ref: this.state.queue[index].ref })
    const queue = this.state.queue.filter((_, i) => i !== index)
    if (index !== this.state.index) { this.update({ queue, index: index < this.state.index ? this.state.index - 1 : this.state.index }, true); return }
    const playing = this.wantsPlay && ['loading', 'playing'].includes(this.state.status)
    this.stop()
    const next = queue.length ? Math.min(index, queue.length - 1) : -1
    this.update({ queue, index: next }, true)
    if (playing && next >= 0) void this.select(next)
  }

  replaceQueue(queue: Track[]) {
    const current = this.state.queue[this.state.index]
    const index = current ? queue.findIndex(track => trackKey(track) === trackKey(current)) : -1
    if (current && index < 0) this.stop()
    this.update({ queue, index: index >= 0 ? index : queue.length ? 0 : -1 }, true)
  }

  clear() { this.queueChanged?.({ type: 'clear' }); this.stop(); this.update({ queue: [], index: -1 }, true) }
  stop() {
    this.generation++
    this.wantsPlay = false
    this.player?.destroy()
    this.player = undefined
    this.update({ status: 'idle', positionMs: 0, durationMs: 0, error: undefined, embedEngine: undefined, controls: undefined })
  }
}
