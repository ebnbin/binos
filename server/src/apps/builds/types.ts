import type { ArtifactSpec, BuildEnqueue, Settings, Target } from '@binos/protocol/apps/builds'

export type { Artifact, ArtifactSpec, Build, BuildEnqueue, BuildLogMessage, BuildsSnapshot, InstallLink, Settings, Target } from '@binos/protocol/apps/builds'

// 一个平台一个目标，排队时按这个顺序。web 只构建 PR 的提交：main 的 Web 就是上线服务部署的正式版
export const targets = ['web', 'ios'] as const satisfies readonly Target[]
// 构建命令：提交里有这个脚本才构建这个目标
export const targetScripts: Record<Target, string> = { web: 'server/scripts/web-build.ts', ios: 'ios/build.sh' }
// 每个目标产出的产物
export const targetArtifacts: Record<Target, ArtifactSpec[]> = {
  web: [{ name: 'preview', kind: 'link', platform: 'web' }],
  ios: [{ name: 'binos-ios-adhoc.ipa', kind: 'install', platform: 'ios' }],
}
export type BuildRequest = { action: 'status' | 'poll' } | { action: 'stop' | 'handoff' } | ({ action: 'enqueue' } & BuildEnqueue) | { action: 'cancel' | 'retry'; id: string } | ({ action: 'settings' } & Settings)
