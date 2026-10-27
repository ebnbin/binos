// 圆角只用于 binOS 自己画的方块（favicon、BrandMark）；交给系统的图标用全方形，由系统加圆角
const radius = 8

export function logoVariant(source: string, { rounded = false, dark = false }: { rounded?: boolean; dark?: boolean } = {}) {
  let svg = source.replace(/<!--[\s\S]*?-->/g, '').replace(/>\s+</g, '><').trim()
  if (rounded) svg = svg.replace('<rect ', `<rect rx="${radius}" `)
  if (dark) svg = svg.replace(/^<svg[^>]*>/, (open) => `${open}<style>@media (prefers-color-scheme: dark){rect{fill:#fff}[stroke]{stroke:#000}}</style>`)
  return svg
}
