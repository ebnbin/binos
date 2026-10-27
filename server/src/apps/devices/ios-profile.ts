import type { DeviceModel } from './types.js'

export type IosRuntime = {
  identifier: string
  version: string
  isAvailable: boolean
  supportedDeviceTypes?: { identifier: string; name: string; productFamily: string }[]
}
// 本机可用的 iOS runtime，从新到旧
function available(runtimes: IosRuntime[], runtimeId?: string) {
  return runtimes.filter((runtime) => runtime.isAvailable && runtime.identifier.startsWith('com.apple.CoreSimulator.SimRuntime.iOS-') && (!runtimeId || runtime.identifier === runtimeId))
    .sort((a, b) => {
      const left = a.version.split('.').map(Number), right = b.version.split('.').map(Number)
      for (let i = 0; i < Math.max(left.length, right.length); i++) {
        const difference = (right[i] ?? 0) - (left[i] ?? 0)
        if (difference) return difference
      }
      return 0
    })
}
export function iosProfile(runtimes: IosRuntime[], deviceType?: string, runtimeId?: string) {
  const choices = available(runtimes, runtimeId)
  const preferred = deviceType ?? 'com.apple.CoreSimulator.SimDeviceType.iPhone-18-Pro'
  for (const runtime of choices) {
    const found = runtime.supportedDeviceTypes?.find((device) => device.identifier === preferred)
    if (found) return { runtime: runtime.identifier, deviceType: preferred, name: found.name }
  }
  if (!deviceType) {
    for (const runtime of choices) {
      const phone = runtime.supportedDeviceTypes?.find((device) => device.productFamily === 'iPhone')
      if (phone) return { runtime: runtime.identifier, deviceType: phone.identifier, name: phone.name }
    }
  }
  throw new Error(`没有可用的兼容 iOS runtime 与机型组合${runtimeId ? `：${runtimeId}` : ''}${deviceType ? ` / ${deviceType}` : ''}`)
}
// 可用 runtime 支持的所有机型；不指定机型时用的那一个标为 default
export function iosModels(runtimes: IosRuntime[], deviceType?: string, runtimeId?: string): DeviceModel[] {
  const models = new Map<string, DeviceModel>()
  for (const runtime of available(runtimes, runtimeId)) {
    for (const type of runtime.supportedDeviceTypes ?? []) {
      const model = models.get(type.identifier) ?? { platform: 'ios', id: type.identifier, name: type.name, family: type.productFamily, systems: [] }
      model.systems.push(runtime.version)
      models.set(type.identifier, model)
    }
  }
  if (models.size) {
    const fallback = iosProfile(runtimes, deviceType, runtimeId).deviceType
    models.get(fallback)!.default = true
  }
  return [...models.values()]
}
// 申请里的机型可以写标识，也可以写名称（不区分大小写）
export function iosModel(models: DeviceModel[], query: string) {
  const found = models.find((model) => model.id === query) ?? models.find((model) => model.name.toLowerCase() === query.toLowerCase())
  if (!found) throw new Error(`本机没有可用的 iOS 机型：${query}，用 binos devices models 查看可选机型`)
  return found
}
