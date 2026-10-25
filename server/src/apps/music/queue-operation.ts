import type { QueueOperation, Track } from './types.js'

export const maxQueueTracks = 500
const key = (track: Pick<Track, 'ref'>) => JSON.stringify([track.ref.provider, track.ref.id])

// 一次队列操作作用到 tracks 上；fresh 是队列还没有被改过，只有这时 initialize 才生效。服务端和客户端（先在本地显示）共用
export function applyQueueOperation(tracks: Track[], op: QueueOperation, fresh: boolean): Track[] {
  switch (op.type) {
    case 'clear':
      return []
    case 'remove':
      return tracks.filter((track) => key(track) !== key(op))
    case 'move': {
      const from = tracks.findIndex((track) => key(track) === key(op))
      if (from < 0) return tracks
      const rest = tracks.filter((_, i) => i !== from)
      const to = Math.max(0, Math.min(rest.length, Math.trunc(op.index)))
      return [...rest.slice(0, to), tracks[from], ...rest.slice(to)]
    }
    case 'add':
    case 'initialize': {
      if (op.type === 'initialize' && !fresh) return tracks
      const known = new Set(tracks.map(key))
      const next = [...tracks]
      for (const track of op.tracks) {
        if (!known.has(key(track)) && next.length < maxQueueTracks) {
          next.push(track)
          known.add(key(track))
        }
      }
      return next
    }
  }
}
