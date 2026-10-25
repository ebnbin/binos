import { Collector } from './collect.js'
import type { MonitorStatus, SystemSnapshot } from './types.js'

export class Monitor {
  private collector = new Collector()
  private snapshot: SystemSnapshot | null = null
  private collecting: Promise<void> | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private collectionError: string | undefined
  private listeners = new Set<(status: MonitorStatus) => void>()

  // 每采样一次（成功或失败）收到一次
  subscribe(listener: (status: MonitorStatus) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  start() {
    if (this.timer) return
    const tick = () => {
      void this.refresh().finally(() => {
        this.timer = setTimeout(tick, 5000)
        this.timer.unref()
      })
    }
    this.timer = setTimeout(tick, 0)
    this.timer.unref()
  }
  async refresh() {
    this.collecting ??= this.collector
      .collect()
      .then((snapshot) => {
        this.snapshot = snapshot
        this.collectionError = undefined
      })
      .catch(() => {
        this.collectionError = '暂时无法更新宿主状态'
      })
      .finally(() => {
        this.collecting = undefined
        const status = this.status()
        this.listeners.forEach((listener) => listener(status))
      })
    await this.collecting
  }
  status(): MonitorStatus {
    return { snapshot: this.snapshot, collecting: !!this.collecting, collectionError: this.collectionError }
  }
}
export const monitor = new Monitor()
