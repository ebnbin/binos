import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { logoVariant } from '../web/src/logo.ts'

const repoDir = path.resolve(import.meta.dirname, '..')
export const logoPath = path.join(repoDir, 'design', 'logo.svg')
export const iosDir = path.join(repoDir, 'ios', 'binOS')

// Liquid Glass 的效果加在前景图层上，所以方块做成背景色，字形单独一层。Xcode 编译图标时不跟随软链接，所以生成后提交进仓库
function iosAppIcon(source: string): Record<string, string> {
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
  return { 'AppIcon.icon/icon.json': JSON.stringify(icon, null, 2) + '\n', 'AppIcon.icon/Assets/glyph.svg': glyph }
}

// app 里画在纯黑系统栏上的标志：和 Web 放在外框上的一样，白色圆角方块、黑色字形
function iosLogo(source: string): Record<string, string> {
  const svg = logoVariant(source, { rounded: true }).replace(/(<rect\b[^>]*\bfill=")[^"]*/, '$1#fff').replace(/(\bstroke=")[^"]*/g, '$1#000') + '\n'
  const contents = {
    images: [{ filename: 'logo.svg', idiom: 'universal' }],
    info: { author: 'xcode', version: 1 },
    properties: { 'preserves-vector-representation': true },
  }
  return { 'Assets.xcassets/Logo.imageset/logo.svg': svg, 'Assets.xcassets/Logo.imageset/Contents.json': JSON.stringify(contents, null, 2) + '\n' }
}

// 生成的文件，键是相对 ios/binOS 的路径
export function iosDesign(source: string): Record<string, string> {
  return { ...iosAppIcon(source), ...iosLogo(source) }
}

if (import.meta.main) {
  for (const [name, content] of Object.entries(iosDesign(readFileSync(logoPath, 'utf8')))) {
    mkdirSync(path.dirname(path.join(iosDir, name)), { recursive: true })
    writeFileSync(path.join(iosDir, name), content)
  }
  console.log(`已从 design/logo.svg 生成 ${path.relative(process.cwd(), iosDir)} 里的图标和标志`)
}
