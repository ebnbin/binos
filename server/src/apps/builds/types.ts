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
// iOS 的安装链接，expiresIn 秒内有效
export type InstallLink = { url: string; expiresIn: number }
