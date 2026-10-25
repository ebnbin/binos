import { applyQueueOperation } from '@binos/server/apps/music/queue-operation'
import type { QueueMutation, QueueOperation, QueueSnapshot, Track } from '@binos/server/apps/music/types'

export class QueueSync {
  private pending: QueueMutation[] = []
  private snapshot: QueueSnapshot = { revision: -1, tracks: [] }
  private running = false
  private closed = false
  private retry?: ReturnType<typeof setTimeout>
  private message = '正在同步队列…'
  private listeners = new Set<() => void>()
  private transport: { read(): Promise<QueueSnapshot>; mutate(value: QueueMutation): Promise<QueueSnapshot> }
  private apply: (tracks: Track[]) => void
  constructor(transport: QueueSync['transport'], apply: (tracks: Track[]) => void) { this.transport = transport; this.apply = apply }
  getSnapshot = () => this.message
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private status(message: string) { this.message = message; this.listeners.forEach(listener => listener()) }
  enqueue = (operation: QueueOperation) => {
    this.pending.push({ id: crypto.randomUUID(), operation })
    this.status('正在同步队列…')
    void this.flush()
  }
  private accept(snapshot: QueueSnapshot) {
    if (this.closed) return
    if (snapshot.revision >= this.snapshot.revision) this.snapshot = snapshot
    snapshot = this.snapshot
    // 还没被服务端确认的操作先在本地生效
    this.apply(this.pending.reduce((tracks, { operation }) => applyQueueOperation(tracks, operation, snapshot.revision === 0), snapshot.tracks))
  }
  refresh = async () => {
    try {
      this.accept(await this.transport.read())
      if (!this.pending.length) this.status('队列已在设备间同步')
      return true
    } catch { this.failed(); return false }
  }
  private failed() {
    if (this.closed) return
    this.status('队列尚未同步，正在重试…')
    clearTimeout(this.retry)
    this.retry = setTimeout(() => { if (this.pending.length) void this.flush(); else void this.refresh() }, 3000)
  }
  private async flush() {
    if (this.running || this.closed) return
    this.running = true
    try {
      while (this.pending.length && !this.closed) {
        const snapshot = await this.transport.mutate(this.pending[0])
        this.pending.shift()
        this.accept(snapshot)
      }
      if (!this.closed) this.status('队列已在设备间同步')
    } catch { this.failed() }
    finally { this.running = false }
  }
  close() { this.closed = true; clearTimeout(this.retry) }
}
