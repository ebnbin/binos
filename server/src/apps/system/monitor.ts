import { Collector } from './collect.js'
import type { MonitorStatus, SystemSnapshot } from './types.js'

export class Monitor {
  private collector = new Collector()
  private snapshot: SystemSnapshot | null = null
  private collecting: Promise<void> | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private collectionError: string | undefined
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
      })
    await this.collecting
  }
  status(): MonitorStatus {
    return { snapshot: this.snapshot, collecting: !!this.collecting, collectionError: this.collectionError }
  }
}
export const monitor = new Monitor()
