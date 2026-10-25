import { ApiException } from '../../errors.js'
import type { CatalogPage, Lyrics, MusicErrorCode, PlaybackSource, ProviderInfo, TrackRef } from './types.js'

const statuses = { 'invalid-input': 400, unsupported: 422, configuration: 409, quota: 429, unavailable: 502, network: 502 } as const

export class MusicError extends ApiException {
  constructor(message: string, code: MusicErrorCode) { super(statuses[code], code, message) }
}

export interface MusicProvider {
  info(): ProviderInfo
  configure?(values: Record<string, string>): void
  search?(query: string, page?: string): Promise<CatalogPage>
  playlist?(input: string, page?: string): Promise<CatalogPage>
  resolve?(input: string, page?: string): Promise<CatalogPage>
  recommendations?(id: string, page?: string): Promise<CatalogPage>
  lyrics?(id: string): Promise<Lyrics>
  playback?(ref: TrackRef): Promise<PlaybackSource>
  stream?(id: string, range: string | undefined, signal: AbortSignal): Promise<Response>
}

export function requireCapability(provider: MusicProvider, capability: keyof ProviderInfo['capabilities']) {
  const state = provider.info().capabilities[capability]
  if (!state || state.state === 'unsupported') throw new MusicError('这个音乐来源不支持此功能。', 'unsupported')
  if (state.state !== 'available') throw new MusicError(state.reason, 'configuration')
}
