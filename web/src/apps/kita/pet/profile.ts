// 一只猫的全部差异：长相（颜色、花纹、体型、毛长）和脾气。模型、毛色和行为都只从这里读，换一份就是另一只猫

// sRGB，0~1
export type Rgb = readonly [number, number, number]

export interface CatProfile {
  colors: {
    // 毛的底色和其中偏暖的斑驳
    ground: Rgb
    groundWarm: Rgb
    // 条纹、背中线、尾环
    stripe: Rgb
    // 胸前长毛、肚子、腿内侧
    light: Rgb
    // 下巴、嘴周、喉咙
    white: Rgb
    earInner: Rgb
    nose: Rgb
    noseBridge: Rgb
    paw: Rgb
  }
  eyes: {
    // 虹膜靠瞳孔一圈和外圈
    inner: Rgb
    outer: Rgb
  }
  shape: {
    // 头相对默认大小的缩放
    head: number
    ear: { height: number; width: number; tilt: number }
    cheeks: number
    // 尾巴的节数（每节 2.5 厘米）和粗细缩放
    tail: { segments: number; thickness: number }
  }
  // 各处的毛长，厘米
  fur: {
    body: number
    belly: number
    ruff: number
    chest: number
    cheeks: number
    head: number
    britches: number
    legs: number
    tail: number
    earTufts: number
  }
  pattern: {
    // 身体两侧的竖条纹（鲭鱼斑）：间距（厘米）、粗细 0~1、断成短段的程度 0~1、往下延伸到哪里（-1 到肚子，1 只在背上）
    stripes: { spacing: number; width: number; breakup: number; reach: number }
    dorsal: number
    necklaces: number
    legBars: number
    // 后脚跟后面一段深色
    boots: number
    tailRings: number
    tailTip: number
    face: { foreheadLines: number; cheekLines: number; spectacles: number }
    throatPatch: number
  }
  // 脾气，都是 0~1
  traits: {
    // 多久换一件事、多爱走动
    activity: number
    // 多爱追、扑、疯跑
    playfulness: number
    // 多爱被摸、多爱凑到鼠标跟前
    affection: number
    // 多容易睡着
    sleepiness: number
  }
}
