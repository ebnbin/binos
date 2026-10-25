import type { Capability, ProviderInfo } from './types.js'
import { MusicError, type MusicProvider } from './provider.js'
import { providerSettings, saveProviderSettings } from './settings.js'
import { youtubeCatalog, youtubeInputRules, parseYouTubeInput } from './youtube.js'

const key = () => providerSettings('youtube').apiKey ?? ''
export const youtubeOfficial: MusicProvider = {
  info(): ProviderInfo {
    const available: Capability = { state: 'available' }
    const configured: Capability = key() ? available : { state: 'configuration-required', reason: '请在此来源的设置中配置搜索密钥。单曲链接仍可直接添加。' }
    return {
      id: 'youtube', name: 'YouTube（官方）', description: '官方视频搜索与嵌入播放；单曲链接无需密钥。',
      input: { references: youtubeInputRules },
      capabilities: { search: configured, resolve: available, playlist: configured, playback: available, recommendations: { state: 'unsupported' }, lyrics: { state: 'unsupported' } },
      // 曲目的 id 就是 YouTube 的视频 id，YouTube Music 能直接给出它的音频
      stream: { provider: 'youtube-music' },
      configuration: { fields: [{ id: 'apiKey', label: '搜索密钥', description: '启用 YouTube Data API v3。密钥仅保存在服务端；API 限制设为此 API，请勿使用网站 Referer 限制。', secret: true, configured: Boolean(key()), links: [
        { label: '启用 API', url: 'https://console.cloud.google.com/apis/library/youtube.googleapis.com' },
        { label: '创建密钥', url: 'https://console.cloud.google.com/apis/credentials' },
      ] }] },
    }
  },
  configure: values => {
    if (typeof values.apiKey === 'string' && (values.apiKey.length > 256 || /\s/.test(values.apiKey))) throw new MusicError('请输入有效的搜索密钥。', 'invalid-input')
    saveProviderSettings('youtube', values)
  },
  search: (query, page) => youtubeCatalog.search(query, key(), page),
  playlist: (input, page) => {
    if (parseYouTubeInput(input)?.kind !== 'playlist') throw new MusicError('请输入有效的歌单链接。', 'invalid-input')
    return youtubeCatalog.resolve(input, key(), page)
  },
  resolve: (input, page) => youtubeCatalog.resolve(input, key(), page),
  playback: async ref => {
    if (!/^[\w-]{11}$/.test(ref.id)) throw new MusicError('曲目标识无效。', 'invalid-input')
    return { kind: 'embed', engine: 'youtube', id: ref.id, controls: { seek: true, volume: true } }
  },
}
