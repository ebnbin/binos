import type { PlayerCommand } from './commands.js'

export type TrackRef = { provider: string; id: string }

export type Track = {
  ref: TrackRef
  title: string
  artists: string[]
  album?: { id?: string; title: string }
  artworkUrl?: string
  durationMs?: number
  externalUrl: string
}

export type CatalogPage = { tracks: Track[]; nextPage?: string; warning?: string }

export type MusicErrorCode = 'configuration' | 'invalid-input' | 'unavailable' | 'quota' | 'network' | 'unsupported'

export type PlayerErrorCode = 'invalid-input' | 'not-found' | 'busy' | 'conflict' | 'capacity'
export type MusicApiError = { error: string; code: MusicErrorCode | PlayerErrorCode }

export type QueueOperation = { type: 'add' | 'initialize'; tracks: Track[] } | { type: 'remove'; ref: TrackRef } | { type: 'clear' }
export type QueueSnapshot = { revision: number; tracks: Track[] }
export type QueueMutation = { id: string; operation: QueueOperation }

export type Capability = { state: 'available' } | { state: 'unsupported' } | { state: 'configuration-required'; reason: string }
export type ProviderCapabilities = Record<'search' | 'resolve' | 'playlist' | 'recommendations' | 'lyrics' | 'playback', Capability>
export type ProviderInfo = {
  id: string
  name: string
  description: string
  input: { references: { pattern: string; capability: 'resolve' | 'playlist' }[] }
  capabilities: ProviderCapabilities
  configuration: { fields: { id: string; label: string; description: string; secret: boolean; configured: boolean; links?: { label: string; url: string }[] }[] }
}
export type Lyrics = { text: string; attribution?: string }
export type PlaybackSource =
  | { kind: 'audio'; url: string; expiresAt?: number; controls: { seek: boolean; volume: boolean } }
  | { kind: 'embed'; engine: string; id: string; controls: { seek: boolean; volume: boolean } }

export type PlaybackStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error'
export type PlayerState = {
  track: TrackRef | null
  status: PlaybackStatus
  positionMs: number
  durationMs: number
  volume: number
  repeat: 'off' | 'all' | 'one'
  controls: { seek: boolean; volume: boolean }
  error?: string
}
export type PlayerSnapshot = { id: string; label: string; updatedAt: number; state: PlayerState | null }
export type CommandResult = {
  id: string
  playerId: string
  command: PlayerCommand
  status: 'pending' | 'succeeded' | 'failed'
  createdAt: number
  expiresAt: number
  state?: PlayerState
  error?: { code: 'disconnected' | 'timeout' | 'execution'; message: string }
}
export type PlayerMessage =
  | { type: 'connected'; playerId: string }
  | { type: 'command'; command: CommandResult }
export type PlayerCommandRequest = { id: string; command: PlayerCommand }
export type PlayerReport = { state: PlayerState; result?: { id: string; error?: string } }
