import type { CatProfile } from './profile.ts'

// 喜多：长毛棕色鲭鱼斑虎斑猫，数值对照它的照片和视频定的
export const kita: CatProfile = {
  colors: {
    // 偏冷的灰褐，带一点橄榄色；条纹接近纯黑，对比很强
    ground: [0.44, 0.4, 0.34],
    groundWarm: [0.53, 0.45, 0.35],
    stripe: [0.07, 0.06, 0.05],
    // 胸前长毛是浅灰米色，也带纹路，并不白；只有下巴、嘴周和喉咙一小块偏白
    light: [0.58, 0.54, 0.47],
    white: [0.75, 0.73, 0.68],
    earInner: [0.72, 0.58, 0.55],
    // 砖粉色的鼻头，鼻梁偏红棕
    nose: [0.74, 0.47, 0.43],
    noseBridge: [0.55, 0.4, 0.31],
    paw: [0.38, 0.34, 0.29],
  },
  // 黄绿色，瞳孔周围偏琥珀色
  eyes: { inner: [0.52, 0.42, 0.12], outer: [0.35, 0.39, 0.12] },
  shape: {
    head: 1.15,
    // 耳朵又大又高、底宽、尖
    ear: { height: 7, width: 2.3, tilt: 0.38 },
    cheeks: 1.1,
    tail: { segments: 14, thickness: 1.15 },
  },
  fur: { body: 2.6, belly: 3.4, ruff: 3.8, chest: 3.2, cheeks: 2.9, head: 1.1, britches: 3, legs: 1.1, tail: 4.2, earTufts: 1.1 },
  pattern: {
    // 两侧细而密的竖条纹，有的断成短段；背中线一道深色
    stripes: { spacing: 4.2, width: 0.42, breakup: 0.35, reach: -0.35 },
    dorsal: 0.75,
    // 胸前两道深色项链纹
    necklaces: 2,
    // 前腿 3~5 道横纹
    legBars: 4,
    boots: 0.8,
    // 尾巴 8 个深色环，尾尖深色
    tailRings: 8,
    tailTip: 2.5,
    // 额头 5 条细黑线一直到两耳之间；外眼角往后两条线；深色眼线外一圈浅色
    face: { foreheadLines: 5, cheekLines: 2, spectacles: 1 },
    throatPatch: 0.7,
  },
  // 照片里常窝在人腿上、钻盆、趴行李箱：亲人、爱玩，也很能睡
  traits: { activity: 0.6, playfulness: 0.65, affection: 0.8, sleepiness: 0.5 },
}
