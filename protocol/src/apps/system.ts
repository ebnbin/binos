export type Volume = { filesystem: string; mount: string; total: number; available: number; used: number }
export type SystemSnapshot = {
  at: number
  host: { name: string; model: string; chip: string; os: string; uptime: number; cores: number }
  cpu: { percent: number | null }
  memory: { total: number; free: number; cached: number | null; pressure: 'normal' | 'warning' | 'critical' | 'unknown' }
  volumes: Volume[]
  network: { receiveRate: number | null; sendRate: number | null }
  power: { source: string; battery: number | null }
  runtime: { version: string; uptime: number; memory: number; test: boolean }
  unavailable: string[]
}
export type MonitorStatus = { snapshot: SystemSnapshot | null; collecting: boolean; collectionError?: string }
