import type { PlayerCommand } from '@binos/protocol/apps/music'
import type { PlayerState } from '@binos/protocol/apps/music'
import type { MusicController } from './controller.ts'

export function playerState(music: MusicController): PlayerState {
  const state = music.getSnapshot()
  return { track: state.queue[state.index]?.ref ?? null, status: state.status, positionMs: state.positionMs, durationMs: state.durationMs, volume: state.volume, repeat: state.repeat, controls: state.controls ?? { seek: false, volume: true }, ...(state.error && { error: state.error.slice(0, 2000) }) }
}

export async function executePlayerCommand(music: MusicController, command: PlayerCommand, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw new Error('播放器连接已断开。')
  const state = music.getSnapshot()
  if (['play', 'next', 'previous', 'select'].includes(command.type) && !state.queue.length) throw new Error('播放队列为空，请先添加歌曲。')
  if (command.type === 'seek' && (!state.controls?.seek || !state.durationMs || ['idle', 'loading', 'error'].includes(state.status))) throw new Error('当前曲目尚不可调整进度。')
  if (command.type === 'volume' && state.controls?.volume === false) throw new Error('当前播放器不支持调整音量。')
  if (command.type === 'select') {
    const index = state.queue.findIndex(track => track.ref.provider === command.ref.provider && track.ref.id === command.ref.id)
    if (index < 0) throw new Error('歌曲不在共享队列中。')
    void music.select(index)
  } else if (command.type === 'seek') music.seek(command.positionMs)
  else if (command.type === 'volume') music.setVolume(command.volume)
  else if (command.type === 'repeat') music.setRepeat(command.repeat)
  else music[command.type]()
  if (!['play', 'select', 'next', 'previous'].includes(command.type)) return
  const selected = music.getSnapshot().queue[music.getSnapshot().index]?.ref
  await new Promise<void>((resolve, reject) => {
    let unsubscribe = () => {}
    const finish = (error?: Error) => {
      clearTimeout(timer)
      unsubscribe()
      signal.removeEventListener('abort', abort)
      if (error) reject(error)
      else resolve()
    }
    const abort = () => finish(new Error('播放器连接已断开。'))
    const check = () => {
      const current = music.getSnapshot()
      const track = current.queue[current.index]?.ref
      if (track?.provider !== selected?.provider || track?.id !== selected?.id) finish(new Error('播放曲目已被切换。'))
      else if (current.status === 'error') finish(new Error(current.error ?? '播放失败。'))
      else if (current.status === 'playing') finish()
      else if (current.status === 'paused' || current.status === 'idle') finish(new Error('播放已被中断。'))
    }
    const timer = setTimeout(() => finish(new Error('未能确认开始播放；浏览器可能需要用户先点击播放。')), 10000)
    unsubscribe = music.subscribe(check)
    signal.addEventListener('abort', abort, { once: true })
    check()
  })
}
