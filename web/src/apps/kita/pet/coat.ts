import * as THREE from 'three'
import { fbm, smoothstep } from './noise.ts'
import type { CatProfile, Rgb } from './profile.ts'

export type Region = 'torso' | 'chest' | 'neck' | 'head' | 'cheek' | 'muzzle' | 'ear' | 'frontUpper' | 'frontLower' | 'hindUpper' | 'hindLower' | 'hindFoot' | 'paw' | 'tail'

// 按站立时一个顶点的位置算毛色和毛长。坐标都是厘米：
// world 猫的局部空间（+x 朝前、+y 朝上），face 相对头部中心、按头的缩放还原到默认大小，along 沿腿或尾巴从根部量起的距离
export interface CoatPoint {
  region: Region
  world: THREE.Vector3
  normal: THREE.Vector3
  face: THREE.Vector3
  along: number
  // 到最近一只眼睛中心的距离，以眼睛半径为单位
  eye: number
  tailLength: number
}

const color = (rgb: Rgb) => new THREE.Color().setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace)

// 点到线段的距离（只看 x、y）
function toSegment(x: number, y: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax
  const dy = by - ay
  const t = Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(x - ax - dx * t, y - ay - dy * t)
}

export function coatPainter(profile: CatProfile) {
  const palette = Object.fromEntries(Object.entries(profile.colors).map(([key, value]) => [key, color(value)])) as Record<keyof CatProfile['colors'], THREE.Color>
  const { pattern, fur } = profile

  // 两侧的竖条纹：从背上往下、略向后斜，被噪声扭曲，部分断开
  function stripes(world: THREE.Vector3, normal: THREE.Vector3) {
    const { spacing, width, breakup, reach } = pattern.stripes
    const warp = (fbm(world.x * 0.07, world.y * 0.07, world.z * 0.07 + 5) - 0.5) * 6
    const u = world.x - world.y * 0.22 + warp
    const wave = Math.cos((2 * Math.PI * u) / spacing)
    const edge = 1 - 2 * width
    let mask = smoothstep(edge, edge + 0.3, wave)
    mask *= smoothstep(breakup - 0.12, breakup + 0.12, fbm(world.x * 0.35 + 9, world.y * 0.35, world.z * 0.35))
    mask *= smoothstep(reach - 0.2, reach + 0.2, normal.y)
    return mask
  }

  function body(point: CoatPoint, result: THREE.Color) {
    const { region, world, normal } = point
    const front = region === 'torso' ? 0 : smoothstep(0.1, 0.7, normal.x)
    const underside = smoothstep(-0.1, -0.6, normal.y)
    // 胸前长毛浅一些，纹路也淡一些
    result.lerp(palette.light, Math.max(underside * 0.75, front * 0.45))
    const dorsal = smoothstep(0.75, 0.97, normal.y) * pattern.dorsal
    result.lerp(palette.stripe, Math.max(stripes(world, normal) * 0.9 * (1 - front * 0.5), dorsal))
    // 项链纹：胸前一道道横向的深色，断断续续
    for (let index = 0; index < pattern.necklaces; index++) {
      const height = 20.5 - index * 3.3
      const band = smoothstep(0.9, 0.35, Math.abs(world.y + world.x * 0.15 - height - 2.4))
      result.lerp(palette.stripe, band * front * 0.75 * smoothstep(0.3, 0.55, fbm(world.x * 0.5, world.y * 0.5, world.z * 0.5 + 3)))
    }
    if (region === 'neck') {
      const throat = smoothstep(0.4, 0.9, normal.x) * smoothstep(23.5, 25.5, world.y) * smoothstep(3, 1.5, Math.abs(world.z))
      result.lerp(palette.white, throat * pattern.throatPatch)
    }
  }

  function head(point: CoatPoint, result: THREE.Color) {
    const { region, face, eye } = point
    const side = Math.abs(face.z)
    // 额头一排细黑线，从眉心往上一直到两耳之间，往后稍微散开
    const lines = pattern.face.foreheadLines
    const spread = 0.62 + 0.28 * smoothstep(4, -1, face.x)
    let nearest = Infinity
    for (let index = 0; index < lines; index++) {
      nearest = Math.min(nearest, Math.abs(face.z - (index - (lines - 1) / 2) * spread))
    }
    const forehead = smoothstep(0.24, 0.08, nearest) * smoothstep(1.5, 2.4, face.y) * smoothstep(5.4, 3.8, face.x)
    // 后脑勺到脖子的深色
    const crown = smoothstep(1.5, 3, face.y) * smoothstep(-0.5, -3, face.x) * 0.55
    // 外眼角往后的线
    let cheek = 0
    if (pattern.face.cheekLines > 0) {
      cheek = Math.max(cheek, smoothstep(0.28, 0.1, toSegment(face.x, face.y, 3.3, 0.55, 0.1, -0.1)))
    }
    if (pattern.face.cheekLines > 1) {
      cheek = Math.max(cheek, smoothstep(0.26, 0.1, toSegment(face.x, face.y, 3.5, -0.75, 0.4, -1.5)) * 0.85)
    }
    cheek *= smoothstep(1.9, 2.6, side)
    result.lerp(palette.stripe, Math.max(forehead * 0.9, crown, cheek * 0.85))
    // 眼线和外面一圈浅色
    const liner = smoothstep(1.32, 1.12, eye) * pattern.face.spectacles
    const ring = smoothstep(2, 1.45, eye) * (1 - liner) * pattern.face.spectacles
    result.lerp(palette.light, ring * 0.7).lerp(palette.stripe, liner * 0.9)
    // 鼻梁偏红棕
    const bridge = smoothstep(1.1, 0.5, side) * smoothstep(3, 4.2, face.x) * smoothstep(1.6, 0.6, face.y) * smoothstep(-1, -0.2, face.y)
    result.lerp(palette.noseBridge, bridge * 0.75)
    // 胡须垫、嘴周、下巴偏白
    const pads = region === 'muzzle' ? smoothstep(-1, -1.9, face.y) * 0.7 + 0.15 : 0
    const chin = smoothstep(-2.2, -3.2, face.y) * smoothstep(0.5, 2.5, face.x)
    result.lerp(palette.white, Math.min(1, pads + chin))
  }

  return function paint(point: CoatPoint) {
    const { region, world, normal, face, along } = point
    const result = palette.ground.clone().lerp(palette.groundWarm, fbm(world.x * 0.2, world.y * 0.2, world.z * 0.2))
    let length = fur.body
    const underside = smoothstep(-0.1, -0.6, normal.y)
    switch (region) {
      case 'torso':
      case 'chest':
      case 'neck': {
        body(point, result)
        const front = region === 'torso' ? 0 : smoothstep(0.1, 0.7, normal.x)
        const back = smoothstep(0, -0.7, normal.x)
        length = region === 'neck' ? fur.ruff : region === 'chest' ? THREE.MathUtils.lerp(fur.body, fur.chest, front) : fur.body
        length = THREE.MathUtils.lerp(length, fur.belly, underside)
        // 臀部后面的"裤子"
        if (region === 'torso' && world.x < -8) {
          length = THREE.MathUtils.lerp(length, fur.britches, back * 0.6)
        }
        break
      }
      case 'head':
      case 'cheek':
      case 'muzzle':
        head(point, result)
        length = region === 'muzzle' ? 0.5 : region === 'cheek' ? fur.cheeks * (0.7 + 0.3 * smoothstep(-0.5, -2.5, face.y)) * profile.shape.cheeks : fur.head
        break
      case 'ear': {
        // 耳背是底色偏深，耳朵里面是长长的浅色耳毛
        const inner = smoothstep(-0.1, 0.5, normal.x)
        result.lerp(palette.stripe, 0.35 * (1 - inner)).lerp(palette.earInner, inner * 0.55).lerp(palette.white, inner * 0.2)
        length = 0.3 + inner * fur.earTufts * smoothstep(4, 8, face.y)
        break
      }
      case 'frontUpper':
      case 'frontLower':
      case 'hindUpper':
      case 'hindLower':
      case 'hindFoot': {
        const period = 9.5 / Math.max(1, pattern.legBars)
        const bars = smoothstep(0.35, 0.8, Math.cos((2 * Math.PI * along) / period)) * smoothstep(0.25, 0.5, fbm(world.x * 0.4, world.y * 0.4, world.z * 0.4 + 7))
        result.lerp(palette.stripe, bars * (region === 'hindUpper' || region === 'frontUpper' ? 0.5 : 0.85))
        if (region === 'hindFoot') {
          result.lerp(palette.stripe, smoothstep(0, -0.6, normal.x) * pattern.boots)
        }
        const back = smoothstep(0, -0.7, normal.x)
        length = region === 'hindUpper' ? THREE.MathUtils.lerp(fur.legs * 1.6, fur.britches, back) : region === 'hindLower' ? fur.legs * (1 + back * 0.6) : region === 'hindFoot' ? fur.legs * 0.6 : region === 'frontUpper' ? fur.legs * 1.3 : fur.legs
        break
      }
      case 'paw':
        result.lerp(palette.paw, 0.7)
        length = 0.6
        break
      case 'tail': {
        const period = point.tailLength / Math.max(1, pattern.tailRings)
        const rings = smoothstep(0.15, 0.6, Math.cos((2 * Math.PI * (along - period * 0.5)) / period))
        const tip = smoothstep(point.tailLength - pattern.tailTip - 1, point.tailLength - pattern.tailTip + 1, along)
        result.lerp(palette.light, underside * 0.35).lerp(palette.stripe, Math.max(rings * 0.85, tip * 0.8))
        length = fur.tail * (1 - 0.45 * smoothstep(0.5, 1, along / point.tailLength))
        break
      }
    }
    result.multiplyScalar(0.88 + 0.24 * fbm(world.x * 0.9 + 3, world.y * 0.9, world.z * 0.9))
    return { color: result, length }
  }
}
