import { describe, expect, it } from 'vitest'
import { iosModel, iosModels, iosProfile } from './ios-profile.js'
import type { IosRuntime } from './ios-profile.js'
const phone = (name: string) => ({ identifier: `com.apple.CoreSimulator.SimDeviceType.${name}`, name: name.replaceAll('-', ' '), productFamily: 'iPhone' })
const runtime = (version: string, phones: string[], isAvailable = true): IosRuntime => ({ identifier: `com.apple.CoreSimulator.SimRuntime.iOS-${version.replaceAll('.', '-')}`, version, isAvailable, supportedDeviceTypes: phones.map(phone) })
describe('iOS 兼容规格', () => {
  const installed = [runtime('27.0', ['iPhone-18-Pro']), runtime('27.1', ['iPhone-Duo'])]
  it('优先机型选择兼容 runtime，不把最新 runtime 与不兼容机型组合', () => {
    expect(iosProfile(installed)).toEqual({ deviceType: phone('iPhone-18-Pro').identifier, name: 'iPhone 18 Pro', runtime: installed[0].identifier })
  })
  it('显式 runtime 选择其支持的 iPhone，显式不兼容组合报错', () => {
    expect(iosProfile(installed, undefined, installed[1].identifier).deviceType).toBe(phone('iPhone-Duo').identifier)
    expect(() => iosProfile(installed, phone('iPhone-18-Pro').identifier, installed[1].identifier)).toThrow('兼容')
  })
  it('缺少优先机型时回退到可用 iPhone，忽略不可用和非 iOS runtime', () => {
    const choices = [runtime('27.2', ['iPhone-18-Pro'], false), runtime('27.1', ['iPhone-Duo']), { ...runtime('28.0', ['iPhone-18-Pro']), identifier: 'com.apple.CoreSimulator.SimRuntime.watchOS-28-0' }]
    expect(iosProfile(choices).runtime).toBe(choices[1].identifier)
    expect(() => iosProfile([])).toThrow('没有可用')
  })
  it('按数字版本选择最新兼容系统，明确指定的机型不会被替换', () => {
    const choices = [runtime('27.2', ['iPhone-18-Pro']), runtime('27.10', ['iPhone-18-Pro'])]
    expect(iosProfile(choices).runtime).toBe(choices[1].identifier)
    expect(() => iosProfile(choices, phone('iPhone-Duo').identifier)).toThrow('兼容')
  })
  it('机型清单合并各 runtime 的系统版本并标出默认机型，申请可以写名称或标识', () => {
    const models = iosModels([runtime('27.0', ['iPhone-18-Pro', 'iPhone-Duo']), runtime('27.1', ['iPhone-Duo'])])
    expect(models.find((model) => model.name === 'iPhone Duo')?.systems).toEqual(['27.1', '27.0'])
    expect(models.filter((model) => model.default).map((model) => model.name)).toEqual(['iPhone 18 Pro'])
    expect(iosModel(models, 'iphone duo').id).toBe(phone('iPhone-Duo').identifier)
    expect(iosModel(models, phone('iPhone-Duo').identifier).name).toBe('iPhone Duo')
    expect(() => iosModel(models, 'iPhone 3G')).toThrow('没有可用')
  })
})
