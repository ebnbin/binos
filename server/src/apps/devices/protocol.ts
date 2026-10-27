import type { Platform, Request } from './types.js'

const actions = new Set(['status', 'discover', 'models', 'stop', 'acquire', 'renew', 'release', 'cancel', 'control', 'screenshot', 'run'])
export function parseRequest(value: unknown): Request {
  if (!value || typeof value !== 'object') throw new Error('请求必须是对象')
  const v = value as Record<string, unknown>
  if (typeof v.action !== 'string' || !actions.has(v.action)) throw new Error('未知设备操作')
  const text = (key: string, max = 256) => typeof v[key] === 'string' && (v[key] as string).length > 0 && (v[key] as string).length <= max && ![...(v[key] as string)].some((char) => char.charCodeAt(0) < 32)
  const need = (...keys: string[]) => { if (keys.some((key) => !text(key))) throw new Error(`缺少有效的 ${keys.join('、')}`) }
  if (['acquire', 'renew', 'release', 'cancel', 'run'].includes(v.action)) need('owner')
  if (['renew', 'release', 'run'].includes(v.action)) need('lease')
  if (v.action === 'cancel') need('requestId')
  if (v.action === 'acquire') {
    if (v.requestId !== undefined && !text('requestId')) throw new Error('无效申请编号')
    if (!Array.isArray(v.platforms) || v.platforms.length < 1 || v.platforms.length > 2 || new Set(v.platforms).size !== v.platforms.length || !v.platforms.every((p) => p === 'android' || p === 'ios')) throw new Error('平台必须是 android、ios 或双端')
    if (typeof v.reason !== 'string' || v.reason.length > 500) throw new Error('用途不能超过 500 个字符')
    if (v.models !== undefined) {
      const models = v.models as Record<string, unknown>
      if (!models || typeof models !== 'object' || Array.isArray(models) || !Object.entries(models).every(([platform, model]) => (v.platforms as string[]).includes(platform) && typeof model === 'string' && model.length > 0 && model.length <= 256)) throw new Error('机型必须按申请的平台填写机型名称或标识')
    }
  }
  if (v.action === 'control') { need('device'); if (v.operation !== 'destroy') throw new Error('未知维护操作') }
  if (v.action === 'screenshot') { need('device'); if (v.owner !== undefined || v.lease !== undefined) need('owner', 'lease') }
  if (v.action === 'run') {
    if (!Array.isArray(v.command) || !v.command.length || v.command.length > 200 || !v.command.every((part) => typeof part === 'string' && part.length < 16_384 && !part.includes('\0'))) throw new Error('无效命令')
    if (!text('cwd', 4096) || !(v.cwd as string).startsWith('/')) throw new Error('需要绝对工作目录')
    if (!Number.isInteger(v.timeout) || Number(v.timeout) < 1000 || Number(v.timeout) > 30 * 60_000) throw new Error('命令超时范围为 1 秒到 30 分钟')
  }
  return v as unknown as Request
}
export function platforms(value: string): Platform[] {
  if (value === 'both') return ['android', 'ios']
  if (value === 'android' || value === 'ios') return [value]
  throw new Error('平台应为 android、ios 或 both')
}
