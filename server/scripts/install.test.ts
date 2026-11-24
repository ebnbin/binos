import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { installBuild, swapPrevious, undoInstall, versionOf } from './install.ts'

// 切回只在上线失败时才会走到，写错了平时发现不了
function setup() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'binos-install-'))
  const make = (dir: string, version: string) => {
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, 'VERSION'), version + '\n')
    return dir
  }
  const slots = { current: make(path.join(root, 'System', 'binos'), 'b'), previous: make(path.join(root, 'deploy', 'previous'), 'a') }
  return { slots, build: make(path.join(root, 'tmp', 'build'), 'c'), aside: path.join(root, 'tmp', 'old') }
}

const versions = (slots: { current: string; previous: string }) => [versionOf(slots.current), versionOf(slots.previous)]

it('装上新构建后原来的版本成为 previous，切回后两个位置都还原', () => {
  const { slots, build, aside } = setup()
  installBuild(build, slots, aside)
  expect(versions(slots)).toEqual(['c', 'b'])
  undoInstall(slots, aside)
  expect(versions(slots)).toEqual(['b', 'a'])
})

it('回退交换 current 和 previous，再交换一次回到原样', () => {
  const { slots, aside } = setup()
  swapPrevious(slots, aside)
  expect(versions(slots)).toEqual(['a', 'b'])
  swapPrevious(slots, aside)
  expect(versions(slots)).toEqual(['b', 'a'])
})
