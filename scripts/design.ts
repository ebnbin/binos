import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const repoDir = path.resolve(import.meta.dirname, '..')
export const logoPath = path.join(repoDir, 'design', 'logo.svg')
export const iosIconDir = path.join(repoDir, 'ios', 'binOS', 'AppIcon.icon')

// iOS 的 App 图标是 Icon Composer 文档：背景填母版方块的颜色，前景是去掉方块的字形，Liquid Glass 的效果由系统加在字形上。
// Xcode 编译图标时不跟随软链接，所以生成后提交进仓库
export function iosAppIcon(source: string): Record<string, string> {
  const svg = source.replace(/<!--[\s\S]*?-->/g, '').trim()
  const hex = /<rect\b[^>]*\bfill="#([0-9a-f]{3}|[0-9a-f]{6})"/i.exec(svg)?.[1]
  if (!hex) throw new Error('design/logo.svg 的方块要用十六进制颜色填充')
  const fill = hex.length === 3 ? [...hex].map((digit) => digit + digit).join('') : hex
  const srgb = [0, 2, 4].map((i) => (parseInt(fill.slice(i, i + 2), 16) / 255).toFixed(5)).join(',')
  // 图层按画布 1024 点摆放，字形要声明成同样大小
  const glyph = svg.replace(/\s*<rect\b[^>]*\/>/, '').replace(/^<svg\b/, '<svg width="1024" height="1024"') + '\n'
  const icon = {
    fill: { solid: `srgb:${srgb},1.00000` },
    groups: [{ layers: [{ 'image-name': 'glyph.svg', name: 'glyph' }] }],
    'supported-platforms': { squares: 'shared' },
  }
  return { 'icon.json': JSON.stringify(icon, null, 2) + '\n', 'Assets/glyph.svg': glyph }
}

if (import.meta.main) {
  for (const [name, content] of Object.entries(iosAppIcon(readFileSync(logoPath, 'utf8')))) {
    mkdirSync(path.dirname(path.join(iosIconDir, name)), { recursive: true })
    writeFileSync(path.join(iosIconDir, name), content)
  }
  console.log(`已从 design/logo.svg 生成 ${path.relative(process.cwd(), iosIconDir)}`)
}
