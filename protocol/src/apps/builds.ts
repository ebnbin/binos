// 一个平台一个目标，排队时按 server/src/apps/builds/types.ts 里 targets 的顺序
export type Target = 'web' | 'ios'
// 产物按用途分类，页面据此决定怎么展示：install 是装到设备上的安装包，link 是外部打开的链接
type InstallSpec = { name: string; kind: 'install'; platform: 'ios' }
type LinkSpec = { name: string; kind: 'link'; platform: 'web' }
export type ArtifactSpec = InstallSpec | LinkSpec
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
// 构建日志的流：log 是从 offset（字节）起的一段文字，第一次连接时从末尾读起，offset 大于 0 表示前面省略了；
// end 是构建结束了、日志也读完了
export type BuildLogMessage = { type: 'log'; offset: number; text: string } | { type: 'end' }
// iOS 的安装链接，expiresIn 秒内有效
export type InstallLink = { url: string; expiresIn: number }
