import path from 'node:path'

// 由 Web 目标的构建（scripts/previews.ts）写入，正式版据此把 PR 子域名的请求转给预览实例
export type PreviewInfo = {
  port: number
  commit: string
}

export function previewDirName(pr: number) {
  return `pr-${pr}`
}

export function previewInfoPath(previewsDir: string, name: string) {
  return path.join(previewsDir, name, 'preview.json')
}

// Universal SSL 只覆盖一级子域名
export function previewUrl(pr: number) {
  return `https://${previewDirName(pr)}.binos.app`
}

// 返回预览目录名
export function previewName(url: string): string | undefined {
  return /^(pr-\d+)\.binos\.app$/.exec(new URL(url).hostname)?.[1]
}
