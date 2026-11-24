import type { PlaybackStatus, Track, TrackRef } from '../../contract.ts'
export type { Track, TrackRef }

export type { PlaybackStatus } from '../../contract.ts'
export type PlayerEvent = { controls?: { seek: boolean; volume: boolean }; embedEngine?: string; status?: PlaybackStatus; positionMs?: number; durationMs?: number; error?: string }

export interface MusicPlayer {
  load(track: TrackRef): Promise<void>
  play(): void
  pause(): void
  seek(positionMs: number): void
  setVolume(volume: number): void
  destroy(): void
}

export type PlayerFactory = (ref: TrackRef, emit: (event: PlayerEvent) => void) => MusicPlayer | undefined

export type MusicState = {
  queue: Track[]
  index: number
  status: PlaybackStatus
  positionMs: number
  durationMs: number
  volume: number
  repeat: 'off' | 'all' | 'one'
  error?: string
  controls?: { seek: boolean; volume: boolean }
  embedEngine?: string
}
