import type { CatalogPage, Lyrics, PlaybackSource, ProviderInfo, ProviderSettings, QueueMutation, QueueSnapshot } from '../../contract.ts'
import { errorMessage, request } from '../../api.ts'

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(await errorMessage(response, '音乐服务暂时不可用'))
  return response.json() as Promise<T>
}
async function providerRequest<T>(provider: string, operation: string, query: string, page?: string, signal?: AbortSignal) {
  return json<T>(await request('GET /api/apps/music/providers/:provider/:operation', { params: { provider, operation }, query: { q: query, page }, signal }))
}
export const catalog = (provider: string, operation: 'search' | 'resolve' | 'playlist' | 'recommendations', query: string, page?: string, signal?: AbortSignal) => providerRequest<CatalogPage>(provider, operation, query, page, signal)
export const playbackSource = (provider: string, id: string, signal?: AbortSignal) => providerRequest<PlaybackSource>(provider, 'playback', id, undefined, signal)
export const readLyrics = (provider: string, id: string, signal?: AbortSignal) => providerRequest<Lyrics>(provider, 'lyrics', id, undefined, signal)
export async function listProviders() { return json<{ providers: ProviderInfo[] }>(await request('GET /api/apps/music/providers')) }
export async function configureProvider(provider: string, values: ProviderSettings) {
  return json<ProviderInfo>(await request('PATCH /api/apps/music/providers/:provider/settings', { params: { provider }, json: values }))
}
export async function readQueue() { return json<QueueSnapshot>(await request('GET /api/apps/music/queue')) }
export async function mutateQueue(mutation: QueueMutation) { return json<QueueSnapshot>(await request('POST /api/apps/music/queue', { json: mutation })) }
