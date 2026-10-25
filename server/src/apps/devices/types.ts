export type Platform = 'android' | 'ios'
export type DeviceStatus = 'creating' | 'checking' | 'free' | 'reserved' | 'leased' | 'cleaning' | 'destroying' | 'broken'
export type Device = {
  id: string
  platform: Platform
  name: string
  target: string
  system?: string
  status: DeviceStatus
  generation?: string
  idleSince?: number
  error?: string
  checkedAt?: number
  attempts?: number
  retryAt?: number
}
export type Lease = { requestId: string; claimed?: true; id: string; owner: string; reason: string; platforms: Platform[]; devices: string[]; createdAt: number; lastSeen: number }
export type Waiting = { id: string; owner: string; reason: string; platforms: Platform[]; devices: string[]; phase: 'waiting' | 'preparing' | 'failed'; error?: string; createdAt: number; lastSeen: number; preparingAt?: number }
export type DeviceEvent = { time: number; text: string; device?: string; owner?: string }
export type State = { version: 2; bootTime?: number; devices: Device[]; leases: Lease[]; queue: Waiting[]; ended: { id: string; owner: string; at: number }[]; events: DeviceEvent[] }
export type ObservedDevice = { platform: Platform; name: string; target: string; state: string }
export type Snapshot = State & { capacity: number; build: string; mode: 'mock' | 'real'; pid: number; startedAt: number; observed: ObservedDevice[]; discoveryErrors: string[] }
export type LeaseResult = { requestId: string; lease?: Lease; position?: number; phase?: Waiting['phase']; error?: string; env?: Record<string, string> }
export type Request =
  | { action: 'status' | 'discover' | 'stop' }
  | { action: 'acquire'; owner: string; reason: string; platforms: Platform[]; requestId?: string }
  | { action: 'renew' | 'release'; owner: string; lease: string }
  | { action: 'cancel'; owner: string; requestId: string }
  | { action: 'control'; device: string; operation: 'destroy' }
  | { action: 'screenshot'; device: string; owner?: string; lease?: string }
  | { action: 'run'; owner: string; lease: string; command: string[]; cwd: string; timeout: number }
export const emptyState = (): State => ({ version: 2, devices: [], leases: [], queue: [], ended: [], events: [] })
// 设备服务回复的截图：image 是 base64 编码的图片，at 是截图的时间
export type DeviceScreenshot = { image: string; mime: string; at: number }
