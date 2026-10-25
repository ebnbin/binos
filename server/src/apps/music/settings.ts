import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { appDir } from '../../paths.js'
import type { ProviderSettings } from './types.js'
const file = () => path.join(appDir('music'), 'settings.json')
type Settings = { youtubeApiKey?: string; providers?: Record<string, Record<string, string>> }
function read(): Settings {
  return existsSync(file()) ? JSON.parse(readFileSync(file(), 'utf8')) as Settings : {}
}
export function providerSettings(id: string): Record<string, string> {
  const settings = read()
  return { ...(id === 'youtube' && settings.youtubeApiKey ? { apiKey: settings.youtubeApiKey } : {}), ...settings.providers?.[id] }
}
export function saveProviderSettings(id: string, values: ProviderSettings) {
  const settings = read()
  const merged: Record<string, string> = { ...providerSettings(id) }
  for (const [key, value] of Object.entries(values)) {
    if (value === null) delete merged[key]
    else merged[key] = value
  }
  settings.providers = { ...settings.providers, [id]: merged }
  if (id === 'youtube') delete settings.youtubeApiKey
  mkdirSync(appDir('music'), { recursive: true })
  writeFileSync(`${file()}.tmp`, JSON.stringify(settings) + '\n', { mode: 0o600 })
  renameSync(`${file()}.tmp`, file())
}
