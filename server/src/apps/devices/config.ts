import { existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { codeDir, devicesServiceDir, isTestInstance } from '../../paths.js'

export const dataDir = devicesServiceDir
export const socketPath = path.join(os.tmpdir(), `binos-devices-${createHash('sha256').update(dataDir).digest('hex').slice(0, 16)}.sock`)
export const adminSocketPath = socketPath.replace('.sock', '-admin.sock')
export const statePath = path.join(dataDir, 'state.json')
export const lockPath = path.join(dataDir, 'manager.lock')
export const mode = process.env.BINOS_DEVICES_MODE === 'real' ? 'real' : isTestInstance || process.env.BINOS_DEVICES_MODE === 'mock' ? 'mock' : 'real'
export const sdkDir = process.env.ANDROID_HOME ?? path.join(os.homedir(), 'Library', 'Android', 'sdk')
export const adb = path.join(sdkDir, 'platform-tools', 'adb')
export const emulator = path.join(sdkDir, 'emulator', 'emulator')
export const avdDir = path.join(dataDir, 'avd')
// 新的 iOS 设备在 Xcode 的默认设备集里，xcodebuild、devicectl 和 Device Hub 都能使用；早先的设备在服务自己的设备集里
export const iosSet = path.join(os.homedir(), 'Library', 'Developer', 'CoreSimulator', 'Devices')
export const legacyIosSet = path.join(dataDir, 'ios')
export const emulatorHome = path.join(dataDir, 'emulator')
export const toolEnv = { ...process.env, ANDROID_HOME: sdkDir, ANDROID_AVD_HOME: avdDir }

const versionFile = path.join(codeDir, 'VERSION')
export const build = existsSync(versionFile) ? readFileSync(versionFile, 'utf8').trim() : 'dev'
export const javaHome = process.env.JAVA_HOME ?? (existsSync('/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home') ? '/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home' : undefined)
