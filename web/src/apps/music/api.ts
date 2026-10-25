import type { MusicApi } from '@binos/server/apps/music/api'
import { errorMessage } from '../../api.ts'
import type { CatalogPage, Lyrics, PlaybackSource, ProviderInfo, ProviderSettings, QueueMutation, QueueSnapshot } from '@binos/server/apps/music/types'
import { hc } from 'hono/client'

const client = hc<MusicApi>(`${window.location.origin}/api/apps/music`)
async function json<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(await errorMessage(response, '音乐服务暂时不可用'))
  return response.json() as Promise<T>
}
async function request<T>(provider: string, operation: string, query: string, page?: string, signal?: AbortSignal) {
  return json<T>(await client.providers[':provider'][':operation'].$get({ param: { provider, operation }, query: { q: query, page } }, { init: { signal } }))
}
export const catalog = (provider: string, operation: 'search' | 'resolve' | 'playlist' | 'recommendations', query: string, page?: string, signal?: AbortSignal) => request<CatalogPage>(provider, operation, query, page, signal)
export const playbackSource = (provider: string, id: string, signal?: AbortSignal) => request<PlaybackSource>(provider, 'playback', id, undefined, signal)
export const readLyrics = (provider: string, id: string, signal?: AbortSignal) => request<Lyrics>(provider, 'lyrics', id, undefined, signal)
export async function listProviders() { return json<{ providers: ProviderInfo[] }>(await client.providers.$get()) }
export async function configureProvider(provider: string, values: ProviderSettings) {
  return json<ProviderInfo>(await client.providers[':provider'].settings.$patch({ param: { provider }, json: values }))
}
export async function readQueue() { return json<QueueSnapshot>(await client.queue.$get()) }
export async function mutateQueue(mutation: QueueMutation) { return json<QueueSnapshot>(await client.queue.$post({ json: mutation })) }
