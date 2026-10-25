import { targets } from './types.js'
import type { Request, Target } from './types.js'
export function parseRequest(value: unknown): Request {
  if (!value || typeof value !== 'object') throw new Error('请求无效')
  const b = value as Record<string, unknown>
  if (b.action === 'status' || b.action === 'poll' || b.action === 'stop' || b.action === 'handoff') return { action: b.action }
  if ((b.action === 'retry' || b.action === 'cancel') && typeof b.id === 'string' && /^[a-f0-9-]{36}$/.test(b.id)) return { action: b.action, id: b.id }
  if (b.action === 'settings' && typeof b.automatic === 'boolean') return { action: 'settings', automatic: b.automatic }
  if (b.action === 'enqueue' && typeof b.ref === 'string' && /^(main|[a-f0-9]{40}|pr\/[1-9]\d*)$/.test(b.ref) && Array.isArray(b.targets) && b.targets.length > 0 && b.targets.every((v) => targets.includes(v))) return { action: 'enqueue', ref: b.ref, targets: [...new Set(b.targets)] as Target[] }
  throw new Error('请求参数无效')
}
