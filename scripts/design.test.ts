import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, it } from 'vitest'
import { iosDesign, iosDir, logoPath } from './design.ts'

it('iOS 的 App 图标和标志是从 design/logo.svg 生成的最新版本', () => {
  for (const [name, content] of Object.entries(iosDesign(readFileSync(logoPath, 'utf8')))) {
    const file = path.join(iosDir, name)
    expect(existsSync(file) && readFileSync(file, 'utf8') === content ? '' : `${path.relative(process.cwd(), file)} 不是最新的，运行 pnpm design 重新生成`).toBe('')
  }
})
