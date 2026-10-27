export type Platform = 'android' | 'ios'
// 设备的屏幕：id 是截图时指定的屏幕，宽高是像素，uid 用来和 devicectl 报告的屏幕对应
export type DeviceDisplay = { id: string; name: string; width: number; height: number; uid?: string }
// 屏幕现在的状态：active 是正在显示内容的屏幕；无法查询时没有 active
export type DisplayState = DeviceDisplay & { active?: boolean }
export type DeviceStatus = 'creating' | 'checking' | 'free' | 'reserved' | 'leased' | 'cleaning' | 'destroying' | 'broken'
export type Device = {
  id: string
  platform: Platform
  name: string
  target: string
  system?: string
  // 机型标识和名称，创建时确定
  model?: string
  modelName?: string
  // iOS 设备所在的设备集
  iosSet?: string
  displays?: DeviceDisplay[]
  status: DeviceStatus
  generation?: string
  idleSince?: number
  error?: string
  checkedAt?: number
  attempts?: number
  retryAt?: number
}
// 申请指定的机型，键是平台，值是机型标识；没有指定的平台用任意机型
export type Models = Partial<Record<Platform, string>>
export type Lease = { requestId: string; claimed?: true; id: string; owner: string; reason: string; platforms: Platform[]; models?: Models; devices: string[]; createdAt: number; lastSeen: number }
export type Waiting = { id: string; owner: string; reason: string; platforms: Platform[]; models?: Models; devices: string[]; phase: 'waiting' | 'preparing' | 'failed'; error?: string; createdAt: number; lastSeen: number; preparingAt?: number }
export type DeviceEvent = { time: number; text: string; device?: string; owner?: string }
export type State = { version: 2; bootTime?: number; devices: Device[]; leases: Lease[]; queue: Waiting[]; ended: { id: string; owner: string; at: number }[]; events: DeviceEvent[] }
export type ObservedDevice = { platform: Platform; name: string; target: string; state: string }
export type Snapshot = State & { capacity: number; build: string; mode: 'mock' | 'real'; pid: number; startedAt: number; observed: ObservedDevice[]; discoveryErrors: string[] }
export type LeaseResult = { requestId: string; lease?: Lease; position?: number; phase?: Waiting['phase']; error?: string; env?: Record<string, string> }
export type Request =
  | { action: 'status' | 'discover' | 'models' | 'stop' }
  | { action: 'acquire'; owner: string; reason: string; platforms: Platform[]; models?: Models; requestId?: string }
  | { action: 'renew' | 'release'; owner: string; lease: string }
  | { action: 'cancel'; owner: string; requestId: string }
  | { action: 'control'; device: string; operation: 'destroy' }
  | { action: 'screenshot'; device: string; display?: string; owner?: string; lease?: string }
  | { action: 'displays'; device: string; owner?: string; lease?: string }
  | { action: 'run'; owner: string; lease: string; command: string[]; cwd: string; timeout: number }
// 可以申请的机型：id 是申请时用的标识，systems 是可选的系统版本，从新到旧
export type DeviceModel = { platform: Platform; id: string; name: string; family: string; systems: string[]; default?: true }
export const emptyState = (): State => ({ version: 2, devices: [], leases: [], queue: [], ended: [], events: [] })
// 设备服务回复的截图：image 是 base64 编码的图片，at 是截图的时间
export type DeviceScreenshot = { image: string; mime: string; at: number }
