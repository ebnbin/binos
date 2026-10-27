// 一个平台一个目标，排队时按这个顺序。web 只构建 PR 的提交：main 的 Web 就是上线服务部署的正式版
export const targets = ['web', 'android', 'ios'] as const
export type Target = typeof targets[number]
// 构建命令：提交里有这个脚本才构建这个目标
export const targetScripts: Record<Target, string> = { web: 'scripts/web-build.ts', android: 'scripts/mobile-build.sh', ios: 'scripts/mobile-build.sh' }
// 产物按用途分类，页面据此决定怎么展示：install 是装到设备上的安装包，link 是外部打开的链接
type InstallSpec = { name: string; kind: 'install'; platform: 'android' | 'ios' }
type LinkSpec = { name: string; kind: 'link'; platform: 'web' }
export type ArtifactSpec = InstallSpec | LinkSpec
// 每个目标产出的产物
export const targetArtifacts: Record<Target, ArtifactSpec[]> = {
  web: [{ name: 'preview', kind: 'link', platform: 'web' }],
  android: [{ name: 'binos-android-debug.apk', kind: 'install', platform: 'android' }],
  ios: [{ name: 'binos-ios-adhoc.ipa', kind: 'install', platform: 'ios' }],
}
export type Artifact = (InstallSpec & { size: number; sha256: string }) | (LinkSpec & { url: string })
export type Build = {
  id: string; commit: string; target: Target; trigger: 'main' | 'pr' | 'manual'; pr?: number
  status: 'queued' | 'running' | 'success' | 'failed' | 'cancelled' | 'interrupted'
  createdAt: string; startedAt?: string; endedAt?: string; error?: string; artifacts: Artifact[]
}
export type Settings = { automatic: boolean }
// prs 是上次检查时开着的 PR，还没检查过时没有
export type BuildsSnapshot = { builds: Build[]; settings: Settings; pollError?: string; checkedAt?: string; prs?: { number: number; title: string }[]; mode: 'real' | 'mock'; version: string }
// 手动构建：ref 是 main、pr/编号 或完整的提交号
export type BuildEnqueue = { ref: string; targets: Target[] }
export type BuildRequest = { action: 'status' | 'poll' } | { action: 'stop' | 'handoff' } | ({ action: 'enqueue' } & BuildEnqueue) | { action: 'cancel' | 'retry'; id: string } | ({ action: 'settings' } & Settings)
// 构建日志的流：log 是从 offset（字节）起的一段文字，第一次连接时从末尾读起，offset 大于 0 表示前面省略了；
// end 是构建结束了、日志也读完了
export type BuildLogMessage = { type: 'log'; offset: number; text: string } | { type: 'end' }
// iOS 的安装链接，expiresIn 秒内有效
export type InstallLink = { url: string; expiresIn: number }
// 登记过的 iOS 设备：product 是型号标识（如 iPhone19,4），model 是它的名称，认不出时同 product；version 是系统的构建版本号（如 24B119）
export type IosDevice = { udid: string; product: string; model: string; name?: string; version?: string; enrolledAt: string }
// provisioned 是这台设备在不在本机最新的 Ad Hoc 描述文件里；本机没有可用的描述文件时没有 profile，provisioned 都是 false
export type IosDevices = { devices: (IosDevice & { provisioned: boolean })[]; profile?: { name: string; expiresAt: string; devices: number } }
// 登记设备的链接：在要登记的设备上打开，下载描述文件，expiresIn 秒内有效
export type EnrollmentLink = { url: string; expiresIn: number }
