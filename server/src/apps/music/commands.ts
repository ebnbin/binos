import type { PlayerCommand, TrackRef } from '@binos/protocol/apps/music'

export type { PlayerCommand } from '@binos/protocol/apps/music'

const fields = {
  ref: { type: 'object', required: ['provider', 'id'], additionalProperties: false, properties: { provider: { type: 'string', minLength: 1, maxLength: 100 }, id: { type: 'string', minLength: 1, maxLength: 500 } } },
  positionMs: { type: 'number', minimum: 0 },
  volume: { type: 'number', minimum: 0, maximum: 1 },
  repeat: { type: 'string', enum: ['off', 'all', 'one'] },
} as const
const actions = {
  play: [], pause: [], stop: [], next: [], previous: [], select: ['ref'], seek: ['positionMs'], volume: ['volume'], repeat: ['repeat'],
} as const satisfies { [K in PlayerCommand['type']]: readonly Exclude<keyof Extract<PlayerCommand, { type: K }>, 'type'>[] }

export const playerCommandSchema = {
  oneOf: Object.entries(actions).map(([type, keys]) => ({
    type: 'object', additionalProperties: false, required: ['type', ...keys],
    properties: { type: { const: type }, ...Object.fromEntries(keys.map(key => [key, fields[key]])) },
  })),
}

export function parsePlayerCommand(value: unknown): PlayerCommand | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return
  const body = value as Record<string, unknown>
  if (typeof body.type !== 'string' || !Object.hasOwn(actions, body.type)) return
  const keys: readonly string[] = actions[body.type as keyof typeof actions]
  if (Object.keys(body).length !== keys.length + 1 || keys.some(key => !Object.hasOwn(body, key))) return
  if ('ref' in body) {
    const ref = body.ref as Record<string, unknown> | null
    if (!ref || typeof ref !== 'object' || Object.keys(ref).length !== 2 || typeof ref.provider !== 'string' || !ref.provider.length || ref.provider.length > 100 || typeof ref.id !== 'string' || !ref.id.length || ref.id.length > 500) return
  }
  if ('positionMs' in body && (typeof body.positionMs !== 'number' || !Number.isFinite(body.positionMs) || body.positionMs < 0)) return
  if ('volume' in body && (typeof body.volume !== 'number' || !Number.isFinite(body.volume) || body.volume < 0 || body.volume > 1)) return
  if ('repeat' in body && !['off', 'all', 'one'].includes(body.repeat as string)) return
  const parsed = Object.fromEntries(['type', ...keys].map(key => [key, body[key]]))
  if (body.type === 'select') {
    const ref = body.ref as TrackRef
    parsed.ref = { provider: ref.provider, id: ref.id }
  }
  return parsed as PlayerCommand
}
