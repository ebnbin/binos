export const targets = ['android', 'ios-simulator', 'ios-adhoc'] as const
export type Target = typeof targets[number]
// 产物按用途分类，页面据此决定怎么展示；目前只有装到设备上的安装包
export type ArtifactSpec = { name: string; kind: 'install'; platform: 'android' | 'ios' }
// 每个目标产出的产物。ios-simulator 只检查能否编译，不产出产物
export const targetArtifacts: Record<Target, ArtifactSpec[]> = {
  android: [{ name: 'binos-android-debug.apk', kind: 'install', platform: 'android' }],
  'ios-simulator': [],
  'ios-adhoc': [{ name: 'binos-ios-adhoc.ipa', kind: 'install', platform: 'ios' }],
}
export type Artifact = ArtifactSpec & { size: number; sha256: string }
export type Build = {
  id: string; commit: string; target: Target; trigger: 'main' | 'pr' | 'manual'; pr?: number
  status: 'queued' | 'running' | 'success' | 'failed' | 'cancelled' | 'interrupted'
  createdAt: string; startedAt?: string; endedAt?: string; error?: string; artifacts: Artifact[]
}
export type Settings = { automatic: boolean; adhoc: boolean }
// prs 是上次检查时开着的 PR，还没检查过时没有
export type Snapshot = { builds: Build[]; settings: Settings; pollError?: string; checkedAt?: string; prs?: { number: number; title: string }[]; mode: 'real' | 'mock'; version: string }
export type Request = { action: 'status' | 'poll' | 'stop' | 'handoff' } | { action: 'enqueue'; ref: string; targets: Target[] } | { action: 'cancel' | 'retry'; id: string } | { action: 'settings'; automatic: boolean; adhoc: boolean }
