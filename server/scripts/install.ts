import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs'
import path from 'node:path'

// 正式版的两个位置：current 是 System/binos，previous 是上一个版本。
// 它们和构建所在的临时目录在同一块磁盘上，安装、切回、回退都只是改名，不复制文件
export type Slots = { current: string; previous: string }

export function versionOf(dir: string): string | undefined {
  try {
    return readFileSync(path.join(dir, 'VERSION'), 'utf8').trim()
  } catch {
    return undefined
  }
}

// 新构建装进 current，原来的 current 变成 previous。更早的 previous 挪进 aside：成功后随临时目录删除，切回时还原
export function installBuild(build: string, slots: Slots, aside: string) {
  mkdirSync(aside, { recursive: true })
  mkdirSync(path.dirname(slots.previous), { recursive: true })
  moveIfExists(slots.previous, path.join(aside, 'previous'))
  moveIfExists(slots.current, slots.previous)
  renameSync(build, slots.current)
}

// 撤销 installBuild：新构建挪进 aside，原来的版本回到 current 和 previous
export function undoInstall(slots: Slots, aside: string) {
  renameSync(slots.current, path.join(aside, 'failed'))
  moveIfExists(slots.previous, slots.current)
  moveIfExists(path.join(aside, 'previous'), slots.previous)
}

// 交换 current 和 previous，用于回退；再交换一次就回到原样
export function swapPrevious(slots: Slots, aside: string) {
  mkdirSync(aside, { recursive: true })
  const swapping = path.join(aside, 'swapping')
  renameSync(slots.previous, swapping)
  renameSync(slots.current, slots.previous)
  renameSync(swapping, slots.current)
}

function moveIfExists(from: string, to: string) {
  if (existsSync(from)) {
    renameSync(from, to)
  }
}
