import type { Models, Platform, State } from '@binos/protocol/apps/devices'

export type { Platform, DeviceDisplay, DisplayState, DeviceStatus, Device, Models, Lease, Waiting, DeviceEvent, State, ObservedDevice, Snapshot, LeaseResult, DeviceModel } from '@binos/protocol/apps/devices'
export type Request =
  | { action: 'status' | 'discover' | 'models' | 'stop' }
  | { action: 'acquire'; owner: string; reason: string; platforms: Platform[]; models?: Models; requestId?: string }
  | { action: 'renew' | 'release'; owner: string; lease: string }
  | { action: 'cancel'; owner: string; requestId: string }
  | { action: 'control'; device: string; operation: 'destroy' }
  | { action: 'screenshot'; device: string; display?: string; owner?: string; lease?: string }
  | { action: 'displays'; device: string; owner?: string; lease?: string }
  | { action: 'run'; owner: string; lease: string; command: string[]; cwd: string; timeout: number }
export const emptyState = (): State => ({ version: 2, devices: [], leases: [], queue: [], ended: [], events: [] })
// 设备服务回复的截图：image 是 base64 编码的图片，at 是截图的时间
export type DeviceScreenshot = { image: string; mime: string; at: number }
